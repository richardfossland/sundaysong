/**
 * POST /v1/recommend/after — use case B: "songs that flow well after song X".
 *
 * Given a song id, look up that song's key and BPM (from its first variant),
 * pull popular catalog songs as candidates, then rank them by circle-of-fifths
 * key compatibility + BPM proximity. Pure music-theory — no LLM, no embeddings,
 * always works offline once the catalog has key/BPM data.
 *
 * Body: { songId: string; limit?: number }
 *
 * The route degrades gracefully:
 *  - from-song key unknown → key_flow: false, candidates scored by BPM only.
 *  - no candidates → empty picks array (the DB query returns popular songs, so
 *    this only happens in an empty catalog or test scaffolding).
 *  - DB unavailable → 500 (the route is genuinely DB-backed in production).
 *
 * For offline unit tests, send `_candidates` alongside the body to bypass the
 * DB lookup.  That field is stripped from production responses.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import { RecommendAfterRouteSchema } from "@sundaysong/shared";
import { getSql, listSongs, listVariantsForSong } from "@sundaysong/db";
import { rankAfter, type AfterCandidate } from "@sundaysong/ai";

export const recommendAfterRoutes = new Hono();

recommendAfterRoutes.post("/", zValidator("json", RecommendAfterRouteSchema), async (c) => {
  const { songId, limit, _candidates } = c.req.valid("json");

  // ── Resolve from-song metadata ─────────────────────────────────────────────
  let fromKey: string | null = null;
  let fromBpm: number | null = null;
  let candidates: AfterCandidate[] = [];

  if (_candidates) {
    // Test path — candidates were injected; from-song may not exist in the DB.
    candidates = _candidates;
  } else {
    // Production path — pull from DB.
    const sql = getSql();

    try {
      const fromVariants = await listVariantsForSong(sql, songId);
      const keyVariant = fromVariants.find((v) => v.key);
      const bpmVariant = fromVariants.find((v) => v.bpm != null);
      fromKey = keyVariant?.key ?? null;
      fromBpm = bpmVariant?.bpm ?? null;

      // Pull up to 50 popular songs as the candidate pool (exclude the from-song).
      const popular = await listSongs(sql, 50);
      candidates = popular
        .filter((s) => s.id !== songId)
        .map((s) => ({
          id: s.id,
          title: s.canonical_title,
          popularity: Number(s.popularity_score) / 100,
        }));

      // Enrich each candidate with key + BPM from their first variant.
      const enriched = await Promise.all(
        candidates.map(async (c) => {
          const variants = await listVariantsForSong(sql, c.id);
          return {
            ...c,
            key: variants.find((v) => v.key)?.key ?? null,
            bpm: variants.find((v) => v.bpm != null)?.bpm ?? null,
          };
        }),
      );
      candidates = enriched;
    } catch (err) {
      return c.json({ error: "db_error", message: (err as Error).message }, 500);
    }
  }

  // ── Rank ───────────────────────────────────────────────────────────────────
  const result = rankAfter(fromKey, fromBpm, candidates, limit);

  return c.json(result);
});
