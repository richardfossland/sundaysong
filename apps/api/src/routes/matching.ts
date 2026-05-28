import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import { MatchScoreInputSchema, MatchCandidatesInputSchema } from "@sundaysong/shared";
import { scoreTranslationCandidate, proposeCandidates } from "@sundaysong/matching";

export const matchingRoutes = new Hono();

/**
 * Cross-language matching (Phase 3.3). Pure scoring over song metadata, so it
 * is live now. Stage/Plan can ask "is the song I'm adding a translation of one
 * we already have?" by passing the metadata they hold; a background job uses
 * the same scoring to propose links across the whole catalog for admin review.
 *
 * Embedding-based recall across the full corpus arrives with semantic search
 * (Phase 3.2, needs pgvector).
 */

// POST /v1/matching/score — score a single pair.
matchingRoutes.post("/score", zValidator("json", MatchScoreInputSchema), (c) => {
  const { a, b } = c.req.valid("json");
  return c.json(scoreTranslationCandidate(a, b));
});

// POST /v1/matching/candidates — rank a pool of songs against a target.
matchingRoutes.post("/candidates", zValidator("json", MatchCandidatesInputSchema), (c) => {
  const { target, pool, min_confidence } = c.req.valid("json");
  return c.json({
    target_id: target.id,
    candidates: proposeCandidates(target, pool, { minConfidence: min_confidence }),
  });
});
