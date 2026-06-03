import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import { RecommendRouteSchema, type Song } from "@sundaysong/shared";
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
//
//   For offline unit tests, pass `_picks` (a fully-hydrated candidate pool) and
//   optionally `_after_key` in the body to bypass the DB + embedder entirely;
//   those fields are never set in production.
recommendRoutes.post("/", zValidator("json", RecommendRouteSchema), async (c) => {
  const input = c.req.valid("json");

  const queryText = [input.theme, input.scripture, input.description].filter(Boolean).join(" ").trim();

  // The candidate pool, plus the key/bpm we'd resolve from each song's first
  // variant — sourced either from the DB (production) or from `_picks` (tests).
  let near: NearestSong[];
  const keysByPickId: Record<string, string | null> = {};
  const bpmByPickId: Record<string, number | null> = {};
  // From-key for use case B: the key of `after_song_id`.
  let afterKey: string | null = null;

  if (input._picks) {
    // Test path — candidates injected fully hydrated; no DB, no embedder.
    // `_picks[].song` is a passthrough object (tests fill only what they need);
    // cast it to the catalog Song the route hydrates back into the response.
    near = input._picks.map((p) => ({ ...(p.song as unknown as Song), score: p.semantic_score }));
    for (const p of input._picks) {
      keysByPickId[p.song.id] = p.key ?? null;
      bpmByPickId[p.song.id] = p.bpm ?? null;
    }
    afterKey = input._after_key ?? null;
  } else {
    const sql = getSql();

    // Retrieve candidates: semantic when there's a signal, else popular.
    if (queryText) {
      const embedder = getEmbedder();
      const [qvec] = await embedder.embed([queryText]);
      near = await nearestSongs(sql, { vector: qvec!, k: 30, model_version: embedder.modelVersion, language: input.language });
    } else {
      const songs = await listSongs(sql, 30);
      near = songs.map((s) => ({ ...s, score: 0 }));
    }

    // First variant carrying a key / a BPM, resolved per song from the DB.
    const keyForSong = async (id: string): Promise<string | null> =>
      (await listVariantsForSong(sql, id)).find((v) => v.key)?.key ?? null;
    const bpmForSong = async (id: string): Promise<number | null> =>
      (await listVariantsForSong(sql, id)).find((v) => v.bpm != null)?.bpm ?? null;

    await Promise.all(
      near.map(async (n) => {
        keysByPickId[n.id] = await keyForSong(n.id);
        bpmByPickId[n.id] = await bpmForSong(n.id);
      }),
    );

    if (input.after_song_id) {
      afterKey = await keyForSong(input.after_song_id);
    }
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

  // The suggested key per pick (and the from-song key for use case B) were
  // resolved above — from each song's first variant in production, or from the
  // injected `_picks` in tests. No further DB access from here on.

  // Use case B: "songs that flow well after song X" — re-order the same picks
  // by circle-of-fifths key compatibility with the from-song's key. Offline,
  // no LLM; degrades to a no-op (keyFlow:false) if the from-key isn't known.
  let ordered = ranked;
  let keyFlow = false;
  if (input.after_song_id && afterKey) {
    const flowed = applyKeyFlow(ranked, { fromKey: afterKey, keysByPickId });
    ordered = flowed;
    keyFlow = flowed.keyFlow;
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
