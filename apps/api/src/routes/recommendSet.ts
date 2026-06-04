/**
 * POST /v1/recommend/set — use case E: "build me a whole service".
 *
 * The flagship recommender. Given a theme/scripture seed plus a target size or
 * duration, an energy arc and the musical constraints (tempo-jump cap, key-flow
 * continuity, major/minor balance), it composes a single ORDERED set rather
 * than a flat ranking. Retrieval mirrors /v1/recommend (embed the query, pull
 * nearest songs via pgvector, or fall back to popular songs); the orchestration
 * is the pure, deterministic `composeSet` from @sundaysong/ai.
 *
 * The composition itself is offline + LLM-free — the value is in jointly
 * satisfying the constraints, which `composeSet` does with a beam search over a
 * single explainable objective (relevance + arc fit + key flow + tempo
 * smoothness − mode-balance / hard-constraint penalties).
 *
 * For offline unit tests, send `_candidates` (a fully-hydrated pool) to bypass
 * the DB + embedder. That field is never set in production.
 *
 * INFRA-UNVERIFIED: the production path needs Postgres + pgvector for retrieval
 * and variant key/BPM; the composition is unit-tested in @sundaysong/ai.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import { RecommendSetRouteSchema, type Song } from "@sundaysong/shared";
import { getSql, nearestSongs, listSongs, listVariantsForSong, type NearestSong } from "@sundaysong/db";
import { getEmbedder, composeSet, type SetCandidate } from "@sundaysong/ai";

export const recommendSetRoutes = new Hono();

recommendSetRoutes.post("/", zValidator("json", RecommendSetRouteSchema), async (c) => {
  const input = c.req.valid("json");

  const queryText = [input.theme, input.scripture, input.description].filter(Boolean).join(" ").trim();

  // ── Build the candidate pool (DB in production, `_candidates` in tests) ──────
  let candidates: SetCandidate[];
  // Keep the hydrated songs around so we can return full Song objects per slot.
  const songById = new Map<string, Song>();

  if (input._candidates) {
    candidates = input._candidates.map((p) => ({
      id: p.id,
      canonical_title: p.canonical_title,
      themes: p.themes,
      bible_refs: p.bible_refs,
      popularity_score: p.popularity_score,
      language: p.language,
      semantic_score: p.semantic_score,
      key: p.key ?? null,
      bpm: p.bpm ?? null,
      suggested_key: p.key ?? null,
      duration_sec: p.duration_sec ?? null,
    }));
  } else {
    const sql = getSql();
    try {
      let near: NearestSong[];
      if (queryText) {
        const embedder = getEmbedder();
        const [qvec] = await embedder.embed([queryText]);
        near = await nearestSongs(sql, {
          vector: qvec!,
          k: 40,
          model_version: embedder.modelVersion,
          language: input.language,
        });
      } else {
        const songs = await listSongs(sql, 40);
        near = songs.map((s) => ({ ...s, score: 0 }));
      }

      // Resolve key + BPM from each song's first carrying variant.
      candidates = await Promise.all(
        near.map(async (n) => {
          const variants = await listVariantsForSong(sql, n.id);
          const { score, ...song } = n;
          songById.set(n.id, song as unknown as Song);
          return {
            id: n.id,
            canonical_title: n.canonical_title,
            themes: n.themes,
            bible_refs: n.bible_refs,
            popularity_score: Number(n.popularity_score),
            language: n.original_language,
            semantic_score: n.score,
            key: variants.find((v) => v.key)?.key ?? null,
            bpm: variants.find((v) => v.bpm != null)?.bpm ?? null,
            suggested_key: variants.find((v) => v.key)?.key ?? null,
            duration_sec: null,
          } satisfies SetCandidate;
        }),
      );
    } catch (err) {
      return c.json({ error: "db_error", message: (err as Error).message }, 500);
    }
  }

  // ── Compose ──────────────────────────────────────────────────────────────────
  const result = composeSet(
    {
      theme: input.theme,
      scripture: input.scripture,
      description: input.description,
      language: input.language,
      arc: input.arc,
      target_size: input.target_size,
      target_duration_min: input.target_duration_min,
      constraints: input.constraints,
    },
    candidates,
  );

  // Hydrate each slot back to a full Song where we have one (DB path); in the
  // test path we synthesise a minimal Song from the injected candidate so the
  // response shape is identical.
  const candById = new Map(candidates.map((cd) => [cd.id, cd]));
  const slots = result.slots.map((slot) => {
    const full = songById.get(slot.song_id);
    const cd = candById.get(slot.song_id)!;
    const song: Song =
      full ??
      ({
        id: cd.id,
        canonical_title: cd.canonical_title,
        original_language: cd.language,
        year_first_published: null,
        copyright_status: "unknown",
        ccli_song_id: null,
        tono_work_id: null,
        tono_registered: false,
        hymnary_id: null,
        popularity_score: cd.popularity_score,
        nordic_metadata: {},
        themes: cd.themes,
        bible_refs: cd.bible_refs,
        created_at: "",
        updated_at: "",
      } satisfies Song);
    return {
      position: slot.position,
      song,
      score: slot.score,
      reason: slot.reason,
      suggested_key: slot.suggested_key,
      bpm: slot.bpm,
      energy: slot.energy,
      target_energy: slot.target_energy,
      tempo_violation: slot.tempo_violation,
    };
  });

  return c.json({
    slots,
    total_minutes_estimate: result.total_minutes_estimate,
    major_ratio: result.major_ratio,
    trajectory: result.trajectory,
    tempo_violations: result.tempo_violations,
    summary: result.summary,
    arc: input.arc,
  });
});
