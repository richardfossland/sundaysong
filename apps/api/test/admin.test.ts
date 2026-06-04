/**
 * Integration tests for the admin API surface — POST/GET /v1/admin/*.
 *
 * Three route groups (Phase 8/9): the moderation queue, source sync-run
 * history, and search-volume analytics. The pure moderation state machine
 * (`applyAction`) is fully tested in `@sundaysong/shared`; these tests verify
 * the ROUTE layer:
 *   (a) the auth guard rejects unauthenticated requests when configured,
 *   (b) moderation applies the state machine + persists only legal transitions,
 *   (c) analytics returns the aggregated summary the dashboard consumes.
 *
 * Everything is offline — no Postgres, no network. We inject an in-memory
 * `AdminStore` fake (the same dependency-injection seam `createUsageRoutes`
 * uses) and, for the auth tests, a real `requireAuth` built over a locally
 * generated RS256 key set (mirroring auth.test.ts) — no JWKS fetch.
 */

import { describe, expect, test, beforeAll } from "bun:test";
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type KeyLike, type JWK } from "jose";

import type { UploadRecord, UploadStatus } from "@sundaysong/shared";
import {
  createAdminRoutes,
  type AdminStore,
  type SourceSyncRun,
  type AnalyticsSummary,
} from "../src/routes/admin";
import { createVerifier, requireAuth } from "../src/middleware/auth";

// ── In-memory store fake ─────────────────────────────────────────────────────

const upload = (over: Partial<UploadRecord> & { id: string }): UploadRecord => ({
  song_id: "song-" + over.id,
  title: over.id,
  language: "no",
  submitted_by: "leader@church.no",
  submitted_at: "2026-01-01T00:00:00.000Z",
  status: "pending",
  copyright_status: "public_domain",
  moderator_note: null,
  ...over,
});

interface FakeStoreOptions {
  uploads?: UploadRecord[];
  runs?: SourceSyncRun[];
  analytics?: AnalyticsSummary;
  /**
   * Force the optimistic-concurrency guard to report a lost update: when true,
   * `saveModeration` writes nothing and returns 0 rows-affected, simulating a
   * row that another moderator already moved on from. Mirrors the conditional
   * `where id=$1 and status=$expected` missing in the live store.
   */
  conflict?: boolean;
}

/**
 * A minimal in-memory `AdminStore`. `saved` captures every persisted
 * moderation decision so tests assert the route writes the right new status.
 * `saveModeration` honours the optimistic-concurrency guard: it only "updates"
 * when the row is still at `expectedStatus`, returning the rows-affected count
 * (0 → the route returns 409).
 */
function fakeStore(opts: FakeStoreOptions = {}) {
  const uploads = new Map((opts.uploads ?? []).map((u) => [u.id, { ...u }]));
  const saved: Array<{ id: string; expectedStatus: UploadStatus; status: UploadStatus; note?: string }> = [];
  const store: AdminStore = {
    async listUploads(status) {
      const all = [...uploads.values()];
      return status ? all.filter((u) => u.status === status) : all;
    },
    async getUpload(id) {
      return uploads.get(id) ?? null;
    },
    async saveModeration(id, expectedStatus, status, note) {
      const u = uploads.get(id);
      // The conditional update: only lands when the row is still at the status
      // we loaded it at (and the test hasn't forced a conflict).
      if (opts.conflict || !u || u.status !== expectedStatus) return 0;
      saved.push({ id, expectedStatus, status, note });
      u.status = status;
      u.moderator_note = note ?? null;
      return 1;
    },
    async listSyncRuns() {
      return opts.runs ?? [];
    },
    async analytics() {
      return (
        opts.analytics ?? { top_queries: [], coverage_gaps: [], total_searches: 0, catalog_size: 0 }
      );
    },
  };
  return { store, saved };
}

// ── Local RS256 keyset for the auth-guard tests ──────────────────────────────

const AUD = "sundaysong";
const ISS = "https://accounts.sunday.test";

let priv: KeyLike;
let kid: string;
let jwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = (await exportJWK(publicKey)) as JWK;
  jwk.kid = crypto.randomUUID();
  jwk.alg = "RS256";
  jwk.use = "sig";
  priv = privateKey;
  kid = jwk.kid;
  jwks = createLocalJWKSet({ keys: [jwk] });
});

const signAdmin = (): Promise<string> =>
  new SignJWT({ sub: "admin_1", app_grants: ["admin"] })
    .setProtectedHeader({ alg: "RS256", kid })
    .setSubject("admin_1")
    .setIssuedAt()
    .setAudience(AUD)
    .setIssuer(ISS)
    .setExpirationTime("1h")
    .sign(priv);

// ── Request helpers ───────────────────────────────────────────────────────────

const get = (routes: ReturnType<typeof createAdminRoutes>, path: string, token?: string) =>
  routes.request(path, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

const moderate = (
  routes: ReturnType<typeof createAdminRoutes>,
  id: string,
  body: unknown,
  token?: string,
) =>
  routes.request(`/uploads/${id}/moderate`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

// ── (a) Auth guards ───────────────────────────────────────────────────────────

describe("admin auth guard (when configured)", () => {
  const guarded = () => {
    const { store } = fakeStore({ uploads: [upload({ id: "u1" })] });
    return createAdminRoutes({ store, auth: requireAuth(createVerifier({ keys: jwks, audience: AUD, issuer: ISS })) });
  };

  test("401 without a bearer token", async () => {
    const res = await get(guarded(), "/uploads");
    expect(res.status).toBe(401);
  });

  test("401 with an invalid token", async () => {
    const res = await get(guarded(), "/uploads", "not.a.jwt");
    expect(res.status).toBe(401);
  });

  test("200 with a valid admin token", async () => {
    const token = await signAdmin();
    const res = await get(guarded(), "/uploads", token);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { uploads: UploadRecord[] };
    expect(json.uploads).toHaveLength(1);
  });

  test("the default (unconfigured) guard is a transparent pass-through", async () => {
    // No `auth` override → adminScoped(); with no JWKS env it stays open, so
    // the dev surface + the rest of these tests work with no token.
    const { store } = fakeStore({ uploads: [upload({ id: "u1" })] });
    const res = await get(createAdminRoutes({ store }), "/uploads");
    expect(res.status).toBe(200);
  });
});

// ── (b) Moderation ────────────────────────────────────────────────────────────

describe("GET /v1/admin/uploads", () => {
  test("returns the full queue", async () => {
    const { store } = fakeStore({ uploads: [upload({ id: "u1" }), upload({ id: "u2", status: "approved" })] });
    const res = await get(createAdminRoutes({ store }), "/uploads");
    const json = (await res.json()) as { uploads: UploadRecord[] };
    expect(json.uploads).toHaveLength(2);
  });

  test("filters by status", async () => {
    const { store } = fakeStore({
      uploads: [upload({ id: "u1", status: "pending" }), upload({ id: "u2", status: "approved" })],
    });
    const res = await get(createAdminRoutes({ store }), "/uploads?status=approved");
    const json = (await res.json()) as { uploads: UploadRecord[] };
    expect(json.uploads).toHaveLength(1);
    expect(json.uploads[0]!.id).toBe("u2");
  });

  test("400 on an unknown status filter", async () => {
    const { store } = fakeStore();
    const res = await get(createAdminRoutes({ store }), "/uploads?status=bogus");
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/admin/uploads/:id/moderate", () => {
  test("approves a pending upload — applies the state machine + persists", async () => {
    const { store, saved } = fakeStore({ uploads: [upload({ id: "u1", status: "pending" })] });
    const routes = createAdminRoutes({ store });

    const res = await moderate(routes, "u1", { action: "approve" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { upload_id: string; status: UploadStatus };
    expect(json).toEqual({ upload_id: "u1", status: "approved" });

    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual({ id: "u1", expectedStatus: "pending", status: "approved", note: undefined });
  });

  test("request_changes persists the moderator note", async () => {
    const { store, saved } = fakeStore({ uploads: [upload({ id: "u1", status: "pending" })] });
    const res = await moderate(createAdminRoutes({ store }), "u1", { action: "request_changes", note: "add a CCLI number" });

    expect(res.status).toBe(200);
    expect(saved[0]).toEqual({
      id: "u1",
      expectedStatus: "pending",
      status: "changes_requested",
      note: "add a CCLI number",
    });
  });

  test("guards the write on the loaded status (optimistic concurrency)", async () => {
    // The conditional update must be threaded the status we loaded + validated
    // the transition against, so the live SQL becomes `where id and status=$`.
    const { store, saved } = fakeStore({ uploads: [upload({ id: "u1", status: "changes_requested" })] });
    const res = await moderate(createAdminRoutes({ store }), "u1", { action: "approve" });

    expect(res.status).toBe(200);
    expect(saved[0]!.expectedStatus).toBe("changes_requested");
    expect(saved[0]!.status).toBe("approved");
  });

  test("409 when the conditional update reports 0 rows — already claimed", async () => {
    // A concurrent moderator already moved the row: `saveModeration` returns 0
    // rows-affected (the `where … and status=$expected` matched nothing). The
    // route must NOT report success — it returns 409 Conflict.
    const { store, saved } = fakeStore({ uploads: [upload({ id: "u1", status: "pending" })], conflict: true });
    const res = await moderate(createAdminRoutes({ store }), "u1", { action: "approve" });

    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: string; message: string };
    expect(json.error).toBe("conflict");
    expect(json.message).toMatch(/another moderator/i);
    // Nothing was persisted — the other moderator's decision stands.
    expect(saved).toHaveLength(0);
  });

  test("422 on an illegal transition — and nothing is persisted", async () => {
    const { store, saved } = fakeStore({ uploads: [upload({ id: "u1", status: "approved" })] });
    const res = await moderate(createAdminRoutes({ store }), "u1", { action: "approve" });

    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: string; message: string };
    expect(json.error).toBe("invalid_transition");
    expect(json.message).toContain("approve");
    expect(saved).toHaveLength(0);
  });

  test("422 when a required note is missing — and nothing is persisted", async () => {
    const { store, saved } = fakeStore({ uploads: [upload({ id: "u1", status: "pending" })] });
    const res = await moderate(createAdminRoutes({ store }), "u1", { action: "reject" });

    expect(res.status).toBe(422);
    expect((await res.json() as { message: string }).message).toContain("note");
    expect(saved).toHaveLength(0);
  });

  test("404 when the upload doesn't exist", async () => {
    const { store } = fakeStore();
    const res = await moderate(createAdminRoutes({ store }), "missing", { action: "approve" });
    expect(res.status).toBe(404);
  });

  test("400 on an unknown action", async () => {
    const { store } = fakeStore({ uploads: [upload({ id: "u1" })] });
    const res = await moderate(createAdminRoutes({ store }), "u1", { action: "obliterate" });
    expect(res.status).toBe(400); // zValidator rejects the enum
  });
});

// ── (c) Sync runs + analytics ─────────────────────────────────────────────────

describe("GET /v1/admin/sources/sync-runs", () => {
  test("returns the sync history", async () => {
    const run: SourceSyncRun = {
      source_id: "src-1",
      source_name: "Hymnary.org",
      started_at: "2026-01-01T10:00:00.000Z",
      finished_at: "2026-01-01T10:01:00.000Z",
      status: "partial",
      rows_in: 100,
      rows_upserted: 97,
      errors: ["row 12: missing title"],
    };
    const { store } = fakeStore({ runs: [run] });
    const res = await get(createAdminRoutes({ store }), "/sources/sync-runs");
    const json = (await res.json()) as { runs: SourceSyncRun[] };
    expect(json.runs).toHaveLength(1);
    expect(json.runs[0]!.status).toBe("partial");
    expect(json.runs[0]!.errors).toHaveLength(1);
  });
});

describe("GET /v1/admin/analytics", () => {
  test("returns the aggregated summary", async () => {
    const summary: AnalyticsSummary = {
      top_queries: [{ query: "nåde", count: 120, zero_results: false }],
      coverage_gaps: [{ query: "obscure carol", count: 4 }],
      total_searches: 5000,
      catalog_size: 1200,
    };
    const { store } = fakeStore({ analytics: summary });
    const res = await get(createAdminRoutes({ store }), "/analytics");
    const json = (await res.json()) as AnalyticsSummary;
    expect(json.total_searches).toBe(5000);
    expect(json.top_queries[0]!.query).toBe("nåde");
    expect(json.coverage_gaps[0]!.query).toBe("obscure carol");
  });
});
