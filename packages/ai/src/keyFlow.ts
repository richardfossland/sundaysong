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

import { parseKey, keyCompatibilityScore, keyFlowScore, type Key } from "@sundaysong/music";

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

// ── Use case B: dedicated "after" ranker ─────────────────────────────────────

/** A song candidate enriched with its key and BPM for flow ranking. */
export interface AfterCandidate {
  id: string;
  title: string;
  key?: string | null;
  bpm?: number | null;
  /** Optional popularity or heuristic score (0..1). Used as a tiebreaker. */
  popularity?: number;
}

/** One item in the ranked "after" result. */
export interface AfterPick {
  song_id: string;
  title: string;
  /** Combined 0..1 flow+BPM score. */
  score: number;
  /** Human-readable explanation of why this song flows well. */
  reason: string;
  suggested_key?: string | null;
}

export interface RankAfterResult {
  picks: AfterPick[];
  /** Key of the from-song as parsed (echoed back for the API response). */
  from_key: string | null;
  /** True when key flow was applied (from-key was resolvable). */
  key_flow: boolean;
}

/** BPM weight: songs within 20 BPM get a bonus that decays linearly. */
const BPM_BONUS_MAX = 0.15;
const BPM_BONUS_WINDOW = 20;

/**
 * Rank `candidates` by how well they flow after a song in `fromKey` with BPM
 * `fromBpm`. Pure, offline, deterministic — no LLM, no DB.
 *
 * Scoring:
 *   keyScore  = keyFlowScore(fromKey, candidate.key)  [0..1, per spec table]
 *   bpmBonus  = max(0, 1 - |fromBpm - bpm| / BPM_BONUS_WINDOW) * BPM_BONUS_MAX
 *             (only applied when both BPMs are known and within the window)
 *   popularity = popularity ?? 0  (gentle tiebreaker, max 0.1 contribution)
 *   final     = keyScore + bpmBonus + 0.1 * popularity  (normalised to 0..1)
 */
export function rankAfter(
  fromKey: string | null | undefined,
  fromBpm: number | null | undefined,
  candidates: AfterCandidate[],
  limit = 5,
): RankAfterResult {
  const resolvedFromKey = fromKey ?? null;
  const hasKey = resolvedFromKey !== null && parseKey(resolvedFromKey) !== null;

  const scored = candidates.map((c) => {
    // Key compatibility
    let keyScore = 0.5; // neutral when from-key unknown
    if (hasKey) {
      keyScore = c.key ? keyFlowScore(resolvedFromKey!, c.key) : 0.5;
    }

    // BPM proximity bonus
    let bpmBonus = 0;
    if (typeof fromBpm === "number" && typeof c.bpm === "number" && c.bpm > 0) {
      const diff = Math.abs(fromBpm - c.bpm);
      if (diff < BPM_BONUS_WINDOW) {
        bpmBonus = (1 - diff / BPM_BONUS_WINDOW) * BPM_BONUS_MAX;
      }
    }

    // Popularity tiebreaker (soft)
    const popBonus = 0.1 * Math.min(1, (c.popularity ?? 0));

    const raw = keyScore + bpmBonus + popBonus;
    // Normalise — max possible is 1.0 + 0.15 + 0.1 = 1.25, cap at 1.
    const score = Math.min(1, Math.round(raw * 1000) / 1000);

    // Build a human reason
    const parts: string[] = [];
    if (hasKey && c.key) {
      const ks = keyFlowScore(resolvedFromKey!, c.key);
      if (ks >= 1.0) parts.push(`same key as ${resolvedFromKey}`);
      else if (ks >= 0.85) parts.push(`closely related key (${c.key})`);
      else if (ks >= 0.65) parts.push(`compatible key (${c.key})`);
      else parts.push(`key ${c.key}`);
    }
    if (bpmBonus > 0 && c.bpm) parts.push(`similar tempo (${c.bpm} BPM)`);
    if (parts.length === 0) parts.push("catalog match");
    const reason = parts.join(" · ");

    return { c, score, reason };
  });

  scored.sort((a, b) => b.score - a.score);

  const picks: AfterPick[] = scored.slice(0, limit).map(({ c, score, reason }) => ({
    song_id: c.id,
    title: c.title,
    score,
    reason,
    suggested_key: c.key ?? null,
  }));

  return {
    picks,
    from_key: resolvedFromKey,
    key_flow: hasKey,
  };
}
