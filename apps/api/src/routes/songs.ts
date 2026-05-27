import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import { SongSearchQuerySchema, SemanticSearchSchema } from "@sundaysong/shared";

export const songsRoutes = new Hono();

// GET /v1/songs/search?q=&language=&themes=&page=&page_size=
songsRoutes.get("/search", zValidator("query", SongSearchQuerySchema), async (c) => {
  const q = c.req.valid("query");
  // TODO Phase 3.1 — query Meilisearch
  return c.json({
    hits: [],
    total: 0,
    page: q.page,
    page_size: q.page_size,
    note: "stub — Meilisearch integration lands in Phase 3.1",
  });
});

// POST /v1/songs/semantic-search
songsRoutes.post("/semantic-search", zValidator("json", SemanticSearchSchema), async (c) => {
  const body = c.req.valid("json");
  // TODO Phase 3.2 — embed query + pgvector similarity search
  return c.json({
    hits: [],
    query: body.query,
    note: "stub — embedding + pgvector wiring lands in Phase 3.2",
  });
});

// GET /v1/songs/:id
songsRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  // TODO Phase 1.2 — repository.get(id)
  return c.json({
    id,
    error: "not_yet_wired",
    note: "Repository implementation lands in Phase 1.2",
  }, 501);
});
