import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import { LicensingReportInputSchema, CoverageInputSchema } from "@sundaysong/shared";
import { computeCoverage } from "@sundaysong/licensing";

export const licensingRoutes = new Hono();

/**
 * POST /v1/licensing/coverage
 *
 * Per-song coverage for the "✓ CCLI + TONO" / "⚠ Check TONO" pill. Pure
 * logic over the song metadata the caller already holds, so it is live now —
 * Stage and Plan pass a song + the church's licensing profile and get back
 * CCLI/TONO status plus the gray areas a human should review.
 */
licensingRoutes.post(
  "/coverage",
  zValidator("json", CoverageInputSchema),
  (c) => {
    const { song, profile } = c.req.valid("json");
    return c.json(computeCoverage(song, profile));
  },
);

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
    // The report engine (buildLicensingReport in @sundaysong/licensing) is
    // built and tested; this route stays stubbed only until the usage_log +
    // song queries land with the repository layer (Phase 1.2).
    return c.json({
      church_id,
      period_from: from,
      period_to: to,
      ccli_rows: [],
      tono_rows: [],
      coverage_warnings: ["stub — usage_log + song aggregation lands with the repository layer (Phase 1.2)"],
    });
  },
);
