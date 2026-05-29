import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import { LicensingReportInputSchema, CoverageInputSchema } from "@sundaysong/shared";
import { computeCoverage, buildLicensingReport, reportCsv } from "@sundaysong/licensing";
import { getSql, getChurchLicensing, usageForPeriod, getSongsByIds } from "@sundaysong/db";

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
    const sql = getSql();

    const profile = await getChurchLicensing(sql, church_id);
    if (!profile) {
      return c.json({ error: "no_licensing_profile", message: "No licensing profile on file for this church." }, 404);
    }

    const usage = await usageForPeriod(sql, church_id, from, to);
    const songIds = [...new Set(usage.map((u) => u.song_id))];
    const songs = await getSongsByIds(sql, songIds);

    const report = buildLicensingReport({ profile, songs, usage, period: { from, to } });
    return c.json(report);
  },
);

/**
 * POST /v1/licensing/report.csv?system=ccli|tono
 *
 * Same report, serialized as a CSV the church can submit directly. CCLI gets
 * the standard sheet; TONO gets Norwegian headers with streamed vs in-room
 * performances split out, as the licensor expects.
 */
licensingRoutes.post(
  "/report.csv",
  zValidator("json", LicensingReportInputSchema),
  async (c) => {
    const { church_id, from, to } = c.req.valid("json");
    const system = c.req.query("system") === "tono" ? "tono" : "ccli";
    const sql = getSql();

    const profile = await getChurchLicensing(sql, church_id);
    if (!profile) {
      return c.json({ error: "no_licensing_profile", message: "No licensing profile on file for this church." }, 404);
    }

    const usage = await usageForPeriod(sql, church_id, from, to);
    const songIds = [...new Set(usage.map((u) => u.song_id))];
    const songs = await getSongsByIds(sql, songIds);
    const report = buildLicensingReport({ profile, songs, usage, period: { from, to } });

    const csv = reportCsv(report, system);
    const filename = `${system}-report_${from}_${to}.csv`;
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="${filename}"`);
    return c.body(csv);
  },
);
