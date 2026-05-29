import { Hono } from "hono";
import { getSql, listSources } from "@sundaysong/db";

export const sourcesRoutes = new Hono();

// GET /v1/sources — the data sources we index, with per-source variant counts.
sourcesRoutes.get("/", async (c) => {
  const sources = await listSources(getSql());
  return c.json({ sources });
});
