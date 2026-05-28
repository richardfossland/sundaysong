import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import { SongSearchQuerySchema, SemanticSearchSchema } from "@sundaysong/shared";
import { getSql, getSong, listVariantsForSong, searchSongsByTitle } from "@sundaysong/db";

export const songsRoutes = new Hono();

// GET /v1/songs/search?q=&language=&themes=&page=&page_size=
songsRoutes.get("/search", zValidator("query", SongSearchQuerySchema), async (c) => {
  const q = c.req.valid("query");
  const sql = getSql();
  const songs = await searchSongsByTitle(sql, q.q, q.page_size);
  const hits = await Promise.all(
    songs.map(async (song) => ({
      song,
      variants: await listVariantsForSong(sql, song.id),
      translations: [],
      match_reason: "text" as const,
      score: 1,
    })),
  );
  return c.json({ hits, total: hits.length, page: q.page, page_size: q.page_size });
});

// POST /v1/songs/semantic-search
songsRoutes.post("/semantic-search", zValidator("json", SemanticSearchSchema), async (c) => {
  const body = c.req.valid("json");
  // Embedding + pgvector similarity lands in Phase 3.2 (needs an embedding model).
  return c.json({
    hits: [],
    query: body.query,
    note: "stub — embedding + pgvector wiring lands in Phase 3.2",
  });
});

// GET /v1/songs/:id
songsRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const sql = getSql();
  const song = await getSong(sql, id);
  if (!song) return c.json({ error: "not_found", id }, 404);
  const variants = await listVariantsForSong(sql, id);
  return c.json({ ...song, variants });
});
