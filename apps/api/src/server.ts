/**
 * SundaySong API — Hono on Bun.
 *
 * Public, versioned REST surface consumed by the web app, the SDK, and the
 * other Sunday products. Postgres + Meilisearch backed; CORS-locked to the
 * suite; rate-limited per caller; standard JSON error envelope.
 */

import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";

import { getSql } from "@sundaysong/db";
import { MeiliClient } from "@sundaysong/search";

import { songsRoutes } from "./routes/songs";
import { recommendRoutes } from "./routes/recommend";
import { usageRoutes } from "./routes/usage";
import { licensingRoutes } from "./routes/licensing";
import { transposeRoutes } from "./routes/transpose";
import { matchingRoutes } from "./routes/matching";
import { sourcesRoutes } from "./routes/sources";
import { translateRoutes } from "./routes/translate";
import { recommendAfterRoutes } from "./routes/recommendAfter";
import { recommendSeasonRoutes } from "./routes/recommendSeason";
import { adminRoutes } from "./routes/admin";
import { rateLimit } from "./middleware/rateLimit";

const app = new Hono();

app.use("*", logger());

// Attach a request id so logs + error responses can be correlated.
app.use("*", async (c, next) => {
  const id = c.req.header("x-request-id") ?? crypto.randomUUID();
  c.header("X-Request-Id", id);
  await next();
});

app.use("*", cors({
  origin: (origin) => {
    // Phase 5.1: lock to known Sunday-suite origins by default. Allowlist
    // configurable for partner integrations via API_CORS_ORIGINS (csv).
    const extra = (Bun.env.API_CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const allow = [
      "http://localhost:3000",
      "http://localhost:5173",
      "https://sundaysong.com",
      "https://app.sundaystage.com",
      "https://app.sundayplan.com",
      ...extra,
    ];
    return allow.includes(origin ?? "") ? origin : "https://sundaysong.com";
  },
  credentials: true,
}));

// Free-tier rate limit on the public API (Phase 5.1). Override via env.
app.use("/v1/*", rateLimit({
  limit: Number(Bun.env.API_RATE_LIMIT ?? 100),
  windowMs: Number(Bun.env.API_RATE_WINDOW_MS ?? 60_000),
}));

// Deep health — reports DB + search reachability so a load balancer / uptime
// check sees a real picture, not just "the process is up".
app.get("/health", async (c) => {
  const checks: Record<string, "ok" | "down"> = { db: "down", search: "down" };
  try { await getSql()`select 1`; checks.db = "ok"; } catch { /* stays down */ }
  try { const h = await new MeiliClient().health(); if (h.status === "available") checks.search = "ok"; } catch { /* stays down */ }
  const ok = checks.db === "ok" && checks.search === "ok";
  return c.json({ ok, version: "0.1.0", checks }, ok ? 200 : 503);
});

app.route("/v1/songs/translate", translateRoutes); // before /v1/songs so it matches first
app.route("/v1/songs",            songsRoutes);
app.route("/v1/recommend/after",  recommendAfterRoutes);  // before /v1/recommend so it matches first
app.route("/v1/recommend/season", recommendSeasonRoutes); // before /v1/recommend so it matches first
app.route("/v1/recommend",        recommendRoutes);
app.route("/v1/usage",        usageRoutes);
app.route("/v1/licensing",    licensingRoutes);
app.route("/v1/transpose",    transposeRoutes);
app.route("/v1/matching",     matchingRoutes);
app.route("/v1/sources",      sourcesRoutes);
app.route("/v1/admin",        adminRoutes); // moderation + analytics (Phase 8/9), admin-scoped

app.notFound((c) => c.json({ error: "not_found", message: "No such endpoint." }, 404));
app.onError((err, c) => {
  console.error("[api] unhandled error:", err);
  return c.json({ error: "internal", message: err.message }, 500);
});

const port = Number(Bun.env.PORT ?? 3001);
console.log(`SundaySong API listening on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
