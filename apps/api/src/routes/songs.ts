import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import { SongSearchQuerySchema, SemanticSearchSchema } from "@sundaysong/shared";
import { getSql, getSong, getSongsByIds, listVariantsForSong, lyricistsForSong, searchSongsByTitle, translationsForSong, translationsForSongs, nearestSongs } from "@sundaysong/db";
import { MeiliClient, SONG_INDEX } from "@sundaysong/search";
import { getEmbedder } from "@sundaysong/ai";

export const songsRoutes = new Hono();

// Flatten translation rows into the lean shape search/semantic hits carry.
const slimTranslations = (links: Array<{ language: string; song_id: string; title: string }>) =>
  links.map((t) => ({ language: t.language, song_id: t.song_id, title: t.title }));

// Quote + escape a value for a Meilisearch filter (prevents filter injection).
const filterValue = (v: string) => `"${v.replace(/"/g, '\\"')}"`;

// GET /v1/songs/search?q=&language=&themes=&page=&page_size=
songsRoutes.get("/search", zValidator("query", SongSearchQuerySchema), async (c) => {
  const q = c.req.valid("query");
  const sql = getSql();

  try {
    const filters: string[] = [];
    if (q.language) filters.push(`languages = ${filterValue(q.language)}`);
    if (q.themes?.length) filters.push(`themes IN [${q.themes.map(filterValue).join(", ")}]`);

    const meili = new MeiliClient();
    const res = await meili.search<{ id: string }>(SONG_INDEX, {
      q: q.q,
      filter: filters.length ? filters.join(" AND ") : undefined,
      limit: q.page_size,
      offset: q.page * q.page_size,
    });

    const ids = res.hits.map((h) => h.id);
    const byId = new Map((await getSongsByIds(sql, ids)).map((s) => [s.id, s]));
    const translationsById = await translationsForSongs(sql, ids);
    const hits = [];
    for (const id of ids) {
      const song = byId.get(id);
      if (!song) continue; // index/DB drift — skip rather than 500
      hits.push({
        song,
        variants: await listVariantsForSong(sql, id),
        translations: (translationsById.get(id) ?? []).map((t) => ({
          language: t.language,
          song_id: t.song_id,
          title: t.title,
        })),
        match_reason: "text" as const,
        score: 1,
      });
    }
    return c.json({ hits, total: res.estimatedTotalHits, page: q.page, page_size: q.page_size, engine: "meilisearch" });
  } catch {
    // Meilisearch unavailable → fall back to the Postgres trigram search so the
    // endpoint keeps working (degraded: no facets, no typo tolerance).
    const songs = await searchSongsByTitle(sql, q.q, q.page_size);
    const translationsById = await translationsForSongs(sql, songs.map((s) => s.id));
    const hits = await Promise.all(
      songs.map(async (song) => ({
        song,
        variants: await listVariantsForSong(sql, song.id),
        translations: (translationsById.get(song.id) ?? []).map((t) => ({
          language: t.language,
          song_id: t.song_id,
          title: t.title,
        })),
        match_reason: "text" as const,
        score: 1,
      })),
    );
    return c.json({ hits, total: hits.length, page: q.page, page_size: q.page_size, engine: "postgres_fallback" });
  }
});

// POST /v1/songs/semantic-search
//   Embeds the query and finds the nearest songs via the pgvector HNSW index.
//   Run the embedding worker first (`pnpm embed`) so vectors exist.
songsRoutes.post("/semantic-search", zValidator("json", SemanticSearchSchema), async (c) => {
  const body = c.req.valid("json");
  const sql = getSql();
  const embedder = getEmbedder();

  const [qvec] = await embedder.embed([body.query]);
  const near = await nearestSongs(sql, {
    vector: qvec!,
    k: 20,
    model_version: embedder.modelVersion,
    language: body.language,
  });

  const translationsById = await translationsForSongs(sql, near.map((n) => n.id));
  const hits = await Promise.all(
    near.map(async (n) => {
      const { score, ...song } = n;
      return {
        song,
        variants: await listVariantsForSong(sql, song.id),
        translations: slimTranslations(translationsById.get(song.id) ?? []),
        match_reason: "semantic" as const,
        score,
        semantic_label: `Songs that mean something like “${body.query}”`,
      };
    }),
  );
  return c.json({ hits, query: body.query, model: embedder.modelVersion });
});

// GET /v1/songs/:id
songsRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const sql = getSql();
  const song = await getSong(sql, id);
  if (!song) return c.json({ error: "not_found", id }, 404);
  const [variants, lyricists, translations] = await Promise.all([
    listVariantsForSong(sql, id),
    lyricistsForSong(sql, id),
    translationsForSong(sql, id),
  ]);
  return c.json({ ...song, variants, lyricists, translations });
});
