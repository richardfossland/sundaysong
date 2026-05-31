import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import { RecommendInputSchema } from "@sundaysong/shared";
import { getSql, nearestSongs, listSongs, listVariantsForSong, type NearestSong } from "@sundaysong/db";
import { getEmbedder, rerankPicks, applyKeyFlow, applyArc, getLlmClient, type Candidate } from "@sundaysong/ai";
import { parseKey, type EnergySignals } from "@sundaysong/music";

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

  // First variant carrying a BPM (for energy estimation), independent of key.
  const bpmForSong = async (id: string): Promise<number | null> =>
    (await listVariantsForSong(sql, id)).find((v) => v.bpm != null)?.bpm ?? null;

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

  // Use case D: "build a set with a rising / reflective / celebratory / lament
  // arc" — re-sequence the chosen picks by per-song energy so the running order
  // matches the requested arc shape. Energy comes from each pick's BPM + key +
  // themes (estimateEnergy in @sundaysong/music). Offline, no LLM; degrades to
  // a no-op when no arc is requested.
  // INFRA-UNVERIFIED: this route needs Postgres (variants for BPM/key); the
  // arc sequencing + energy estimation are unit-tested in @sundaysong/{ai,music}.
  let arcApplied = false;
  if (input.arc) {
    const songById0 = new Map(near.map((n) => [n.id, n]));
    const bpmEntries = await Promise.all(ordered.picks.map(async (p) => [p.song_id, await bpmForSong(p.song_id)] as const));
    const bpmByPickId = Object.fromEntries(bpmEntries);
    const signalsByPickId: Record<string, EnergySignals> = {};
    for (const p of ordered.picks) {
      const song = songById0.get(p.song_id);
      const keyStr = keysByPickId[p.song_id];
      signalsByPickId[p.song_id] = {
        bpm: bpmByPickId[p.song_id],
        key: keyStr ? parseKey(keyStr) : null,
        themes: song?.themes ?? [],
        title: song?.canonical_title ?? null,
      };
    }
    const arced = applyArc(ordered, { arc: input.arc, signalsByPickId });
    ordered = arced;
    arcApplied = arced.arcApplied;
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
    arc: arcApplied ? input.arc : undefined,
  });
});
