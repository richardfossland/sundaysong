/**
 * Recommendation use case B — "songs that flow well after song X".
 *
 * The heuristic ranker (recommend.ts) scores by theme / scripture / semantic
 * fit. This layer adds a *set-flow* dimension: given the key of the song you're
 * coming FROM, it favours candidates whose key sits close on the circle of
 * fifths (same key, relative major/minor, a fifth away) so the band can segue
 * without a jarring modulation. See `@sundaysong/music` keyCompatibilityScore
 * for the music theory; this module is the pure glue that folds that 0..1
 * compatibility into an existing `RankResult` and re-orders the picks.
 *
 * Offline + deterministic — no LLM, no DB. The API resolves `after_song_id` to
 * a key (from a variant), passes the picks' suggested keys in, and surfaces the
 * result under the same `/v1/recommend` endpoint.
 */

import { parseKey, keyCompatibilityScore, type Key } from "@sundaysong/music";

import type { RankResult, RankedPick } from "./recommend";

/** How much the key-flow compatibility is allowed to swing the final order. */
const FLOW_WEIGHT = 0.4;

export interface KeyFlowOptions {
  /** Key of the song we are flowing FROM (e.g. "G", "Am", "Bb"). */
  fromKey: string;
  /**
   * Suggested key per candidate song id (typically from a variant). Picks with
   * no resolvable key are left at their heuristic position with no flow boost.
   */
  keysByPickId: Record<string, string | null | undefined>;
}

/** Parse a key string defensively; unknown/empty → null (no boost applied). */
function tryKey(s: string | null | undefined): Key | null {
  if (!s) return null;
  return parseKey(s);
}

/**
 * Re-rank an existing heuristic result by how smoothly each pick flows after a
 * given key. Pure. The new score is a blend of the heuristic score and the key
 * compatibility, so a strongly on-theme song can still beat a perfect-key song
 * that's off-theme — flow is a tiebreaker, not an override.
 *
 * Picks whose key can't be resolved keep their heuristic score (no boost, no
 * penalty) and a note that the key is unknown. The returned result is flagged
 * `keyFlow: true` and carries the resolved `fromKey` for the API to echo.
 */
export function applyKeyFlow(result: RankResult, opts: KeyFlowOptions): RankResult & { keyFlow: boolean } {
  const from = tryKey(opts.fromKey);
  if (!from || result.picks.length === 0) {
    return { ...result, keyFlow: false };
  }

  const scored = result.picks.map((pick) => {
    const to = tryKey(opts.keysByPickId[pick.song_id]);
    if (!to) {
      return { pick, blended: pick.score, reason: pick.reason };
    }
    const compat = keyCompatibilityScore(from, to);
    const blended = (1 - FLOW_WEIGHT) * pick.score + FLOW_WEIGHT * compat.score;
    const reason = `${pick.reason} · flows well: ${compat.reason}`;
    return { pick, blended, reason };
  });

  // Stable sort by the blended score, descending. Array.prototype.sort is
  // stable in modern engines, so equal scores keep the heuristic order.
  scored.sort((a, b) => b.blended - a.blended);

  const picks: RankedPick[] = scored.map((s) => ({ ...s.pick, score: Math.round(s.blended * 1000) / 1000, reason: s.reason }));

  return {
    ...result,
    picks,
    summary: `${result.summary} Ordered to flow from ${opts.fromKey}.`,
    keyFlow: true,
  };
}
