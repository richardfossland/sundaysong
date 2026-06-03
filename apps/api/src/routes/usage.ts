import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import { UsageEvent } from "@sundaysong/shared";
import { getSql, logUsage, type LogUsageInput } from "@sundaysong/db";
import { churchScoped } from "../middleware/sundayAuth";

/** Pull the target church id out of the JSON body for the church guard. */
async function churchFromBody(c: { req: { json: () => Promise<unknown> } }): Promise<string | undefined> {
  try {
    const body = (await c.req.json()) as { church_id?: unknown };
    return typeof body.church_id === "string" ? body.church_id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Record a usage event. The production implementation writes to Postgres; tests
 * inject a fake to exercise the route (incl. idempotency dedupe) without a DB —
 * the same dependency-injection seam other routes use to bypass the DB.
 */
type RecordUsage = (event: LogUsageInput) => Promise<{ logged: boolean }>;

const recordToDb: RecordUsage = (event) => logUsage(getSql(), event);

/**
 * Build the `/v1/usage` router. `record` defaults to the real DB writer;
 * tests pass an in-memory fake. `usageRoutes` (the wired default) is what
 * `server.ts` mounts, so production behaviour is unchanged.
 */
export function createUsageRoutes(record: RecordUsage = recordToDb): Hono {
  const routes = new Hono();

  /**
   * POST /v1/usage/log
   *
   * Stage / Plan call this whenever a song is displayed during a service. The
   * body is the canonical `@sunday/contracts` UsageEvent (validated via
   * `UsageEvent`). We dedupe by `idempotency_key` so a re-sent event doesn't
   * double-count.
   *
   * The `was_streamed` flag is the critical bit for TONO reporting —
   * streamed performances feed a different royalty pool than in-room.
   */
  routes.post(
    "/log",
    // Opt-in Sunday auth (no-op until the platform JWKS is configured — keeps the
    // public/dev surface working and existing tests green).
    churchScoped((c) => churchFromBody(c)),
    zValidator("json", UsageEvent),
    async (c) => {
      const event = c.req.valid("json");
      // `schema_version` rides along on the validated event but isn't a DB
      // column; logUsage interpolates only the fields it inserts, so it's a
      // harmless extra key.
      const { logged } = await record(event);
      // logged=false means the idempotency key was already recorded — a no-op.
      return c.json({ ok: true, idempotency_key: event.idempotency_key, logged });
    },
  );

  return routes;
}

/** The wired router mounted by the API server. */
export const usageRoutes = createUsageRoutes();
