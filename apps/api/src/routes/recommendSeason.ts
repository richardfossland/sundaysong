/**
 * POST /v1/recommend/season — use case C: "songs that fit a liturgical season".
 *
 * Given a liturgical season (Advent, Christmas, Lent, Easter, …), returns a
 * curated set of worship songs thematically matched to that season.
 *
 * Body: { season: LiturgicalSeason; limit?: number; language?: string }
 *
 * Retrieval strategy:
 *   1. Embed the season-specific query string from SEASON_DEFINITIONS.
 *   2. Pull nearest songs from pgvector (semantic retrieval).
 *   3. Pass candidates to `rankSeason` for keyword-boosted re-scoring.
 *   4. Return top `limit` picks with reasons + summary.
 *
 * Degradation:
 *   - No embedder API key → embed returns deterministic local vectors; the
 *     semantic component will be weak but keyword scoring still works.
 *   - Empty catalog → empty picks (returns 200 with empty array + message).
 *   - DB unavailable → 500.
 *
 * For offline unit tests, pass `_candidates` in the body to bypass the DB.
 * That field is never set in production.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import { RecommendSeasonRouteSchema } from "@sundaysong/shared";
import { getSql, nearestSongs, listSongs } from "@sundaysong/db";
import { getEmbedder, rankSeason, buildSeasonSummary, SEASON_DEFINITIONS, type SeasonCandidate } from "@sundaysong/ai";

export const recommendSeasonRoutes = new Hono();

recommendSeasonRoutes.post("/", zValidator("json", RecommendSeasonRouteSchema), async (c) => {
  const { season, limit, language, _candidates } = c.req.valid("json");
  const def = SEASON_DEFINITIONS[season];

  let candidates: SeasonCandidate[];

  if (_candidates) {
    // Test path — candidates injected directly; no DB required.
    candidates = _candidates.map((c) => ({
      id: c.id,
      title: c.title,
      themes: c.themes,
      language: c.language,
      semantic_score: c.semantic_score,
    }));
  } else {
    // Production path — semantic retrieval via pgvector + popular fallback.
    const sql = getSql();

    try {
      const embedder = getEmbedder();
      const [queryVec] = await embedder.embed([def.query]);

      const near = await nearestSongs(sql, {
        vector: queryVec!,
        k: Math.min(50, (limit ?? 5) * 10),
        model_version: embedder.modelVersion,
        language: language,
      });

      candidates = near.map((n) => ({
        id: n.id,
        title: n.canonical_title,
        themes: n.themes ?? [],
        language: n.original_language,
        semantic_score: n.score,
      }));

      // If pgvector returned nothing (empty catalog / no embeddings yet),
      // fall back to popularity-ordered songs so the route never returns empty.
      if (candidates.length === 0) {
        const popular = await listSongs(sql, 50);
        candidates = popular
          .filter((s) => !language || s.original_language === language)
          .map((s) => ({
            id: s.id,
            title: s.canonical_title,
            themes: s.themes ?? [],
            language: s.original_language,
            semantic_score: 0,
          }));
      }
    } catch (err) {
      return c.json({ error: "db_error", message: (err as Error).message }, 500);
    }
  }

  // Filter by language if requested (already done in DB query, but also
  // applies to injected test candidates which bypass the DB).
  if (language) {
    candidates = candidates.filter((c) => !c.language || c.language === language);
  }

  const { picks } = rankSeason(season, candidates, limit ?? 5);
  const summary = buildSeasonSummary(season, picks.length);

  return c.json({
    season,
    picks: picks.map((p) => ({
      song_id: p.song_id,
      title: p.title,
      score: p.score,
      reason: p.reason,
    })),
    summary,
  });
});
