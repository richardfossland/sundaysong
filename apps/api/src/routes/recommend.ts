import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import { RecommendInputSchema } from "@sundaysong/shared";
import { getSql, nearestSongs, listSongs, listVariantsForSong, type NearestSong } from "@sundaysong/db";
import { getEmbedder, rerankPicks, applyKeyFlow, getLlmClient, type Candidate } from "@sundaysong/ai";

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

  // Resolve a suggested key (from a variant) for each chosen pick, plus — when
  // an `after_song_id` is given — the key of the song we're flowing FROM.
  const keyForSong = async (id: string): Promise<string | null> =>
    (await listVariantsForSong(sql, id)).find((v) => v.key)?.key ?? null;

  const pickIds = ranked.picks.map((p) => p.song_id);
  const keyEntries = await Promise.all(pickIds.map(async (id) => [id, await keyForSong(id)] as const));
  const keysByPickId = Object.fromEntries(keyEntries);

  // Use case B: "songs that flow well after song X" — re-order the same picks
  // by circle-of-fifths key compatibility with the from-song's key. Offline,
  // no LLM; degrades to a no-op (keyFlow:false) if the from-key isn't known.
  let ordered = ranked;
  let keyFlow = false;
  if (input.after_song_id) {
    const fromKey = await keyForSong(input.after_song_id);
    if (fromKey) {
      const flowed = applyKeyFlow(ranked, { fromKey, keysByPickId });
      ordered = flowed;
      keyFlow = flowed.keyFlow;
    }
  }

  // Hydrate the chosen picks back to full songs (+ the suggested key).
  const songById = new Map(near.map((n) => [n.id, n]));
  const picks = ordered.picks.map((p) => {
    const { score: _score, ...song } = songById.get(p.song_id)!;
    return { song, reason: p.reason, suggested_key: keysByPickId[p.song_id] ?? undefined };
  });

  return c.json({
    picks,
    total_minutes_estimate: ordered.total_minutes_estimate,
    summary: ordered.summary,
    reranked: ranked.reranked ?? false,
    key_flow: keyFlow,
  });
});
