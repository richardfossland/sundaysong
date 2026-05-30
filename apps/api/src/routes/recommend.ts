import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import { RecommendInputSchema } from "@sundaysong/shared";
import { getSql, nearestSongs, listSongs, listVariantsForSong, type NearestSong } from "@sundaysong/db";
import { getEmbedder, rerankPicks, getLlmClient, type Candidate } from "@sundaysong/ai";

export const recommendRoutes = new Hono();

// POST /v1/recommend
//   Body: RecommendInput → ranked, reasoned set grounded in the real catalog.
//   Retrieval = embed (theme + scripture + description), nearest songs via
//   pgvector; heuristic ranking + explanations from @sundaysong/ai always.
//   When ANTHROPIC_API_KEY is set, an LLM re-orders + re-explains the same
//   catalog picks (Sunday Pro); with no key it degrades to the heuristic.
recommendRoutes.post("/", zValidator("json", RecommendInputSchema), async (c) => {
  const input = c.req.valid("json");
  const sql = getSql();

  const queryText = [input.theme, input.scripture, input.description].filter(Boolean).join(" ").trim();

  // Retrieve candidates: semantic when there's a signal, else popular.
  let near: NearestSong[];
  if (queryText) {
    const embedder = getEmbedder();
    const [qvec] = await embedder.embed([queryText]);
    near = await nearestSongs(sql, { vector: qvec!, k: 30, model_version: embedder.modelVersion, language: input.language });
  } else {
    const songs = await listSongs(sql, 30);
    near = songs.map((s) => ({ ...s, score: 0 }));
  }

  const candidates: Candidate[] = near.map((n) => ({
    id: n.id,
    canonical_title: n.canonical_title,
    themes: n.themes,
    bible_refs: n.bible_refs,
    popularity_score: Number(n.popularity_score),
    language: n.original_language,
    semantic_score: n.score,
  }));

  const ranked = await rerankPicks(
    {
      theme: input.theme, scripture: input.scripture, description: input.description,
      arc: input.arc, duration_min: input.duration_min, language: input.language,
    },
    candidates,
    getLlmClient(),
  );

  // Hydrate the chosen picks back to full songs (+ a suggested key from a variant).
  const songById = new Map(near.map((n) => [n.id, n]));
  const picks = await Promise.all(
    ranked.picks.map(async (p) => {
      const { score: _score, ...song } = songById.get(p.song_id)!;
      const variants = await listVariantsForSong(sql, p.song_id);
      const suggested_key = variants.find((v) => v.key)?.key ?? undefined;
      return { song, reason: p.reason, suggested_key };
    }),
  );

  return c.json({
    picks,
    total_minutes_estimate: ranked.total_minutes_estimate,
    summary: ranked.summary,
    reranked: ranked.reranked ?? false,
  });
});
