/**
 * SundaySong API — Hono on Bun.
 *
 * Routes are placeholders; data layer + Postgres wiring lands in Phase 1.2.
 * For now, the server boots, has a health endpoint, and the routes return
 * stubbed shapes so the SDK can compile against them.
 */

import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";

import { songsRoutes } from "./routes/songs";
import { recommendRoutes } from "./routes/recommend";
import { usageRoutes } from "./routes/usage";
import { licensingRoutes } from "./routes/licensing";
import { transposeRoutes } from "./routes/transpose";

const app = new Hono();

app.use("*", logger());
app.use("*", cors({
  origin: (origin) => {
    // Phase 5.1: lock to known Sunday-suite origins by default. Allowlist
    // configurable for partner integrations.
    const allow = [
      "http://localhost:3000",
      "http://localhost:5173",
      "https://sundaysong.com",
      "https://app.sundaystage.com",
      "https://app.sundayplan.com",
    ];
    return allow.includes(origin ?? "") ? origin : "https://sundaysong.com";
  },
  credentials: true,
}));

app.get("/health", (c) => c.json({ ok: true, version: "0.0.1" }));

app.route("/v1/songs",        songsRoutes);
app.route("/v1/recommend",    recommendRoutes);
app.route("/v1/usage",        usageRoutes);
app.route("/v1/licensing",    licensingRoutes);
app.route("/v1/transpose",    transposeRoutes);

app.notFound((c) => c.json({ error: "not_found" }, 404));
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
