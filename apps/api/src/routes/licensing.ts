import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import { LicensingReportInputSchema } from "@sundaysong/shared";

export const licensingRoutes = new Hono();

/**
 * POST /v1/licensing/report
 *
 * Produces BOTH a CCLI and a TONO report from the `usage_log` table for
 * the requested period. This is the Sunday-suite's strategic moat for
 * Nordic churches: most international tools treat TONO as a CSV
 * afterthought; we treat it as first-class.
 *
 * Authentication: Sunday account OIDC required — the church's own admins
 * are the only callers.
 */
licensingRoutes.post(
  "/report",
  zValidator("json", LicensingReportInputSchema),
  async (c) => {
    const { church_id, from, to } = c.req.valid("json");
    // TODO Phase 7.2 — aggregate usage_log + join song
    return c.json({
      church_id,
      period_from: from,
      period_to: to,
      ccli_rows: [],
      tono_rows: [],
      coverage_warnings: ["stub — licensing aggregation lands in Phase 7.2"],
    });
  },
);
