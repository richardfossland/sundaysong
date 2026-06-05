/**
 * Admin API surface — moderation + operational oversight (Phase 8 / Phase 9).
 *
 * Three route groups, all behind the Sunday admin JWT:
 *   1. GET  /v1/admin/uploads?status=        — the user-contribution queue
 *      POST /v1/admin/uploads/:id/moderate   — approve / reject / request changes
 *   2. GET  /v1/admin/sources/sync-runs      — connector sync history
 *   3. GET  /v1/admin/analytics              — search volume + coverage gaps
 *
 * These are consumed by `apps/admin` via its `AdminClient`. The moderation
 * workflow itself is the pure, shared state machine in `@sundaysong/shared`
 * (`applyAction` etc.) so the route and the React UI can never drift.
 *
 * Auth is OPT-IN and admin-scoped: unlike the church-scoped routes (usage /
 * licensing), the admin surface is platform-global — there is no single
 * `church_id` to scope to — so it requires a valid Sunday account JWT
 * (`requireAuth`) but NOT `requireChurch`. When the platform JWKS isn't
 * configured (`SUNDAY_JWKS_URL` + `SUNDAY_AUTH_AUDIENCE`) the guard is a
 * transparent pass-through, exactly like `churchScoped`, so the dev surface +
 * the existing route tests stay green.
 *
 * Everything is built behind a dependency-injection seam (`createAdminRoutes`)
 * — tests inject in-memory store fakes + a local verifier so the whole surface
 * (auth guards, the state-machine application, the analytics aggregation) is
 * exercised offline with no Postgres and no network. `adminRoutes` (the wired
 * default) is what `server.ts` mounts, so production behaviour is unchanged.
 */

import { Hono } from "hono";
import type { Context, MiddlewareHandler, Next } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createRemoteJWKSet } from "jose";

import {
  applyAction,
  type ModerationAction,
  type UploadRecord,
  type UploadStatus,
} from "@sundaysong/shared";
import { getSql } from "@sundaysong/db";
import type { Executor } from "@sundaysong/db";

import { createVerifier, getClaims, requireAuth, type Verifier } from "../middleware/auth";

// ── DI: the store the routes hydrate from ────────────────────────────────────

/** A single source-sync run, in the wire shape the admin dashboard expects. */
export interface SourceSyncRun {
  source_id: string;
  source_name: string;
  started_at: string;
  finished_at: string | null;
  status: "ok" | "partial" | "failed" | "running";
  rows_in: number;
  rows_upserted: number;
  errors: string[];
}

/**
 * One row of the moderation audit trail — an append-only record of WHO did WHAT
 * to an upload and WHEN. Written on every successful moderation so a rejection
 * or approval can always be traced back to a moderator + timestamp (the scalar
 * `upload.moderator_note` only keeps the latest note, not the history).
 */
export interface ModerationAuditEntry {
  upload_id: string;
  /** The Sunday account id (JWT `sub`) of the moderator, or "anonymous" in dev. */
  moderator: string;
  action: ModerationAction;
  /** The status the upload landed in. */
  status: UploadStatus;
  note?: string;
  /** ISO-8601 timestamp of the decision. */
  at: string;
}

/** Search-volume + coverage analytics for the beta dashboard. */
export interface AnalyticsSummary {
  top_queries: Array<{ query: string; count: number; zero_results: boolean }>;
  coverage_gaps: Array<{ query: string; count: number }>;
  total_searches: number;
  catalog_size: number;
}

/**
 * The data access the admin routes need. Production wires Postgres-backed
 * implementations (below); tests inject in-memory fakes. Keeping the store
 * behind this interface is the same seam `createUsageRoutes(record)` uses.
 */
export interface AdminStore {
  /** Pending + recently-moderated uploads, optionally filtered by status. */
  listUploads(status?: UploadStatus): Promise<UploadRecord[]>;
  /** One upload by id, or null when it doesn't exist. */
  getUpload(id: string): Promise<UploadRecord | null>;
  /**
   * Persist a moderation decision under an OPTIMISTIC-CONCURRENCY guard: the
   * update only lands when the row is still at `expectedStatus` (the status we
   * loaded + validated the transition against). Returns the number of rows
   * actually updated — `0` means the row changed under us (another moderator
   * got there first), and the caller must surface a 409 Conflict rather than
   * silently clobbering the other decision.
   */
  saveModeration(
    id: string,
    expectedStatus: UploadStatus,
    status: UploadStatus,
    note?: string,
  ): Promise<number>;
  /**
   * Append one row to the moderation audit trail. Called only AFTER a moderation
   * decision actually lands (a successful `saveModeration`), so the trail never
   * records a decision that didn't take effect.
   */
  recordAudit(entry: ModerationAuditEntry): Promise<void>;
  /** Connector sync history, newest first. */
  listSyncRuns(): Promise<SourceSyncRun[]>;
  /** Aggregated search-volume + coverage-gap analytics. */
  analytics(): Promise<AnalyticsSummary>;
}

// ── Postgres-backed store (production default) ───────────────────────────────

/** Map a raw `sync_run` row + the shared `source.name` into the wire shape. */
function toSyncRun(row: {
  source_id: string;
  source_name: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  rows_in: number;
  rows_upserted: number;
  errors: unknown;
}): SourceSyncRun {
  // The DB constraint allows running|succeeded|failed|partial; the dashboard's
  // vocabulary uses `ok` for a clean run. Everything else maps straight across.
  const status =
    row.status === "succeeded" ? "ok"
    : row.status === "partial" ? "partial"
    : row.status === "running" ? "running"
    : "failed";
  return {
    source_id: row.source_id,
    source_name: row.source_name,
    started_at: row.started_at,
    finished_at: row.finished_at,
    status,
    rows_in: Number(row.rows_in),
    rows_upserted: Number(row.rows_upserted),
    errors: Array.isArray(row.errors) ? (row.errors as string[]) : [],
  };
}

/**
 * The real store. INFRA-UNVERIFIED: the SQL is wired against the 0001 core
 * schema (`upload`, `sync_run`, `source`, `song`) but is exercised in tests via
 * the in-memory fake, not against a live Postgres. The `upload` table lands
 * with the Phase 8 migration; `listUploads`/`getUpload`/`saveModeration` are
 * shaped to it.
 */
export function postgresAdminStore(sqlOverride?: Executor): AdminStore {
  // Resolve the connection lazily (per query) so importing this module — and
  // the wired `adminRoutes` below — never opens a DB connection at load time.
  const exec = (): Executor => sqlOverride ?? getSql();
  return {
    async listUploads(status) {
      const sql = exec();
      const rows = status
        ? await sql<UploadRecord[]>`
            select id, song_id, title, language, submitted_by,
                   submitted_at::text as submitted_at, status,
                   moderator_note, copyright_status
            from upload where status = ${status}
            order by submitted_at desc`
        : await sql<UploadRecord[]>`
            select id, song_id, title, language, submitted_by,
                   submitted_at::text as submitted_at, status,
                   moderator_note, copyright_status
            from upload order by submitted_at desc`;
      return rows;
    },

    async getUpload(id) {
      const sql = exec();
      const rows = await sql<UploadRecord[]>`
        select id, song_id, title, language, submitted_by,
               submitted_at::text as submitted_at, status,
               moderator_note, copyright_status
        from upload where id = ${id}`;
      return rows[0] ?? null;
    },

    async saveModeration(id, expectedStatus, status, note) {
      const sql = exec();
      // CONDITIONAL update: guarded on the status we loaded the row at, so two
      // concurrent moderators can't silently clobber each other (lost-update
      // race). `returning id` lets us count the rows that actually changed —
      // `0` when the row already moved on, which the route turns into a 409.
      const rows = await sql<Array<{ id: string }>>`
        update upload
           set status = ${status}, moderator_note = ${note ?? null}
         where id = ${id} and status = ${expectedStatus}
         returning id`;
      return rows.length;
    },

    async recordAudit(entry) {
      const sql = exec();
      // INFRA-UNVERIFIED: targets the 0005 `moderation_audit` table (append-only).
      await sql`
        insert into moderation_audit (upload_id, moderator, action, status, note, created_at)
        values (${entry.upload_id}, ${entry.moderator}, ${entry.action},
                ${entry.status}, ${entry.note ?? null}, ${entry.at})`;
    },

    async listSyncRuns() {
      const sql = exec();
      const rows = await sql<
        Array<{
          source_id: string; source_name: string; started_at: string;
          finished_at: string | null; status: string;
          rows_in: number; rows_upserted: number; errors: unknown;
        }>
      >`
        select r.source_id,
               s.name as source_name,
               r.started_at::text as started_at,
               r.finished_at::text as finished_at,
               r.status,
               (r.songs_added + r.songs_updated)::int as rows_in,
               (r.songs_added + r.songs_updated)::int as rows_upserted,
               r.errors
        from sync_run r join source s on s.id = r.source_id
        order by r.started_at desc
        limit 100`;
      return rows.map(toSyncRun);
    },

    async analytics() {
      const sql = exec();
      // Search-volume comes from `usage_log` displays grouped by song — the
      // closest signal we durably store today. `coverage_gaps` surfaces zero-
      // result queries once a query log lands (Phase 9); until then it's empty.
      const top = await sql<Array<{ query: string; count: number }>>`
        select s.canonical_title as query, count(*)::int as count
        from usage_log u join song s on s.id = u.song_id
        group by s.canonical_title
        order by count desc
        limit 20`;
      const totals = await sql<Array<{ total: number }>>`
        select count(*)::int as total from usage_log`;
      const catalog = await sql<Array<{ size: number }>>`
        select count(*)::int as size from song`;
      return {
        top_queries: top.map((t) => ({ query: t.query, count: Number(t.count), zero_results: false })),
        coverage_gaps: [],
        total_searches: Number(totals[0]?.total ?? 0),
        catalog_size: Number(catalog[0]?.size ?? 0),
      };
    },
  };
}

// ── Opt-in admin auth (auth-only; mirrors churchScoped) ──────────────────────

let cachedVerifier: { verify: Verifier } | null | undefined;

/** Build (once) the verifier from env, or null when auth isn't configured. */
function configuredVerifier(): { verify: Verifier } | null {
  if (cachedVerifier !== undefined) return cachedVerifier;
  const jwksUrl = Bun.env.SUNDAY_JWKS_URL;
  const audience = Bun.env.SUNDAY_AUTH_AUDIENCE;
  if (!jwksUrl || !audience) {
    cachedVerifier = null;
    return cachedVerifier;
  }
  // NETWORK-UNVERIFIED: remote JWKS fetch + cache happens inside jose.
  const keys = createRemoteJWKSet(new URL(jwksUrl));
  const verify = createVerifier({ keys, audience, issuer: Bun.env.SUNDAY_AUTH_ISSUER });
  cachedVerifier = { verify };
  return cachedVerifier;
}

/**
 * Admin-scoped guard: requires a valid Sunday JWT when auth is configured, and
 * is a transparent pass-through when it isn't (dev / existing tests). No church
 * check — the admin surface is platform-global.
 */
export function adminScoped(): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const cfg = configuredVerifier();
    if (!cfg) return next(); // auth not configured → stay open
    return requireAuth(cfg.verify)(c, next);
  };
}

// ── Validation ────────────────────────────────────────────────────────────────

const UPLOAD_STATUSES: readonly UploadStatus[] = [
  "pending", "approved", "rejected", "changes_requested", "resubmitted",
];
const MODERATION_ACTIONS: readonly ModerationAction[] = [
  "approve", "reject", "request_changes", "resubmit", "reopen",
];

const ModerateBody = z.object({
  action: z.enum(MODERATION_ACTIONS as [ModerationAction, ...ModerationAction[]]),
  note: z.string().optional(),
});

// ── Router factory ──────────────────────────────────────────────────────────

export interface AdminRoutesDeps {
  store: AdminStore;
  /** The auth guard to mount. Defaults to the opt-in `adminScoped()`. */
  auth?: MiddlewareHandler;
}

/**
 * Build the `/v1/admin` router over an injected store + auth guard. Tests pass
 * an in-memory store and (optionally) a real `requireAuth(verifier)` to assert
 * the guard rejects unauthenticated requests.
 */
export function createAdminRoutes(deps: AdminRoutesDeps): Hono {
  const routes = new Hono();
  const auth = deps.auth ?? adminScoped();
  routes.use("*", auth);

  /** GET /v1/admin/uploads?status= — the moderation queue. */
  routes.get("/uploads", async (c) => {
    const raw = c.req.query("status");
    if (raw && !UPLOAD_STATUSES.includes(raw as UploadStatus)) {
      return c.json({ error: "bad_request", message: `Unknown status '${raw}'.` }, 400);
    }
    const uploads = await deps.store.listUploads(raw as UploadStatus | undefined);
    return c.json({ uploads });
  });

  /**
   * POST /v1/admin/uploads/:id/moderate — apply a moderation action.
   *
   * The legal-transition + note-required rules live in the shared state machine
   * (`applyAction`); this handler loads the upload, applies the action, and —
   * only on a legal transition — persists the new status. An illegal action or
   * a missing required note is a 422 with the machine's own error message.
   *
   * Persistence is guarded against the lost-update race: `saveModeration` only
   * writes when the row is still at the status we loaded + validated against
   * (`upload.status`). If a concurrent moderator already moved the row, the
   * conditional update touches `0` rows and we return 409 Conflict rather than
   * clobbering their decision.
   */
  routes.post("/uploads/:id/moderate", zValidator("json", ModerateBody), async (c) => {
    const id = c.req.param("id");
    const { action, note } = c.req.valid("json");

    const upload = await deps.store.getUpload(id);
    if (!upload) {
      return c.json({ error: "not_found", message: "No such upload." }, 404);
    }

    const result = applyAction(upload.status, action, note);
    if (!result.ok) {
      return c.json({ error: "invalid_transition", message: result.error }, 422);
    }

    const updated = await deps.store.saveModeration(id, upload.status, result.status, note);
    if (updated === 0) {
      return c.json(
        {
          error: "conflict",
          message: "This upload was changed by another moderator. Reload the queue and try again.",
        },
        409,
      );
    }

    // The decision landed → append it to the audit trail. The moderator is the
    // authenticated subject (or "anonymous" when auth isn't configured / dev).
    await deps.store.recordAudit({
      upload_id: id,
      moderator: getClaims(c)?.sub ?? "anonymous",
      action,
      status: result.status,
      ...(note !== undefined ? { note } : {}),
      at: new Date().toISOString(),
    });

    return c.json({ upload_id: id, status: result.status });
  });

  /** GET /v1/admin/sources/sync-runs — connector sync history. */
  routes.get("/sources/sync-runs", async (c) => {
    const runs = await deps.store.listSyncRuns();
    return c.json({ runs });
  });

  /** GET /v1/admin/analytics — search-volume + coverage-gap summary. */
  routes.get("/analytics", async (c) => {
    return c.json(await deps.store.analytics());
  });

  return routes;
}

/** The wired router mounted by the API server (Postgres-backed, opt-in auth). */
export const adminRoutes = createAdminRoutes({ store: postgresAdminStore() });
