import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import { UsageLogInputSchema } from "@sundaysong/shared";
import { getSql, logUsage } from "@sundaysong/db";

export const usageRoutes = new Hono();

/**
 * POST /v1/usage/log
 *
 * Stage / Plan call this whenever a song is displayed during a service.
 * We dedupe by `idempotency_key` so a re-sent event doesn't double-count.
 *
 * The `was_streamed` flag is the critical bit for TONO reporting —
 * streamed performances feed a different royalty pool than in-room.
 */
usageRoutes.post(
  "/log",
  zValidator("json", UsageLogInputSchema),
  async (c) => {
    const row = c.req.valid("json");
    const { logged } = await logUsage(getSql(), row);
    // logged=false means the idempotency key was already recorded — a no-op.
    return c.json({ ok: true, idempotency_key: row.idempotency_key, logged });
  },
);
