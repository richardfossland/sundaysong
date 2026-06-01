/**
 * Key compatibility for set flow (the "songs that flow well after song X"
 * feature — recommendation use case B).
 *
 * A worship set feels smooth when consecutive songs sit close on the circle of
 * fifths: the same key, the relative major/minor, or a neighbour a fifth away
 * (the classic IV / V neighbours) share most of their notes, so the band can
 * move between them without a jarring modulation. A tritone away (the far side
 * of the circle) is the harshest move.
 *
 * This is a pure scorer over `Key` (see keys.ts). It does NOT pick songs — it
 * gives the recommender a 0..1 number it can fold into its ranking, plus a
 * short human reason for the explanation surface. Zero dependencies; offline.
 */

import type { Key } from "./keys";
import { keyToString, parseKey } from "./keys";

/**
 * Position of a major-key tonic on the circle of fifths, where C = 0 and each
 * step clockwise is a perfect fifth: C G D A E B F# ... and counter-clockwise
 * F Bb Eb ... The minimal circle-of-fifths distance between two keys is the
 * number of steps along this ring.
 */
const CIRCLE_OF_FIFTHS: readonly number[] = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

/** Index of a pitch class on the circle (0..11). */
function circlePosition(pc: number): number {
  return CIRCLE_OF_FIFTHS.indexOf(((pc % 12) + 12) % 12);
}

/**
 * Distance along the circle of fifths between two tonic pitch classes, 0..6
 * (it wraps, so the max separation is the tritone at 6 steps).
 */
export function circleOfFifthsDistance(fromPc: number, toPc: number): number {
  const a = circlePosition(fromPc);
  const b = circlePosition(toPc);
  const raw = Math.abs(a - b);
  return Math.min(raw, 12 - raw);
}

/** Tonic pitch class of the relative key (major↔minor) of `key`. */
export function relativePc(key: Key): number {
  // Relative minor is a minor third (3 semitones) below the major tonic;
  // relative major is a minor third above the minor tonic.
  return key.minor ? (key.pc + 3) % 12 : (key.pc + 9) % 12;
}

export interface KeyCompatibility {
  /** 0..1, higher = smoother to play `to` straight after `from`. */
  score: number;
  /** Short, human reason for the relationship (for the explanation surface). */
  reason: string;
}

/**
 * Score how well key `to` flows after key `from`, 0..1.
 *
 * The ladder, strongest first:
 *  - identical key (same tonic + same mode) ............ 1.0
 *  - relative major/minor (shared key signature) ....... 0.9
 *  - parallel major/minor (same tonic, swapped mode) ... 0.8
 *  - one step on the circle of fifths (IV / V neighbour) 0.75
 *  - then a smooth decay by circle distance down to the
 *    tritone (farthest, harshest move) ................. ~0.1
 *
 * Mode (major/minor) only nudges the reason text; the geometry is driven by
 * the tonic's position on the circle of fifths, which is what the ear hears.
 */
export function keyCompatibilityScore(from: Key, to: Key): KeyCompatibility {
  const sameTonic = ((from.pc - to.pc) % 12 + 12) % 12 === 0;

  if (sameTonic && from.minor === to.minor) {
    return { score: 1, reason: `same key (${keyToString(to)})` };
  }

  // Relative major/minor: tonics differ but the key signature is shared.
  if (to.pc === relativePc(from) && to.minor !== from.minor) {
    return { score: 0.9, reason: `relative ${to.minor ? "minor" : "major"} of ${keyToString(from)}` };
  }

  // Parallel major/minor: same tonic, opposite mode.
  if (sameTonic && from.minor !== to.minor) {
    return { score: 0.8, reason: `parallel ${to.minor ? "minor" : "major"} of ${keyToString(from)}` };
  }

  const dist = circleOfFifthsDistance(from.pc, to.pc);
  if (dist === 1) {
    return { score: 0.75, reason: `a fifth from ${keyToString(from)} (neighbouring key)` };
  }

  // Linear decay from the one-step neighbour (0.75 at dist=1) down toward the
  // tritone (dist=6). Clamped so even the worst move stays scorable, not zero.
  const score = Math.max(0.1, 0.75 - (dist - 1) * 0.13);
  const reason =
    dist >= 5
      ? `a distant key change from ${keyToString(from)} (${keyToString(to)})`
      : `${dist} steps from ${keyToString(from)} on the circle of fifths`;
  return { score: Math.round(score * 100) / 100, reason };
}

// ── String-key helpers for recommendation use case B ─────────────────────────

/**
 * Circle-of-fifths distance between two key names (e.g. "C", "Am", "Bb").
 * Strips the mode and operates on the tonic pitch classes. Returns 0..6 (the
 * same range as the pitch-class variant). Returns 6 (worst) if either key
 * string cannot be parsed.
 */
export function circleOfFifthsDistanceByName(a: string, b: string): number {
  const ka = parseKey(a);
  const kb = parseKey(b);
  if (!ka || !kb) return 6;
  return circleOfFifthsDistance(ka.pc, kb.pc);
}

/**
 * Compatibility score for recommendation use case B using the simplified
 * distance table requested by the spec:
 *   0 steps → 1.0, 1 → 0.85, 2 → 0.65, 3 → 0.5, 4 → 0.35, 5 → 0.2, 6 → 0.1
 *
 * Parallel major/minor (same tonic, opposite mode) is treated as distance 0
 * (score 1.0) per spec. Relative major/minor (different tonic but shared key
 * signature) is treated as distance 1 (score 0.85).
 *
 * Returns 0 when either key string is invalid (safest degradation — ensures
 * the caller can still rank but won't up-weight unknown keys).
 */
export function keyFlowScore(fromKey: string, toKey: string): number {
  const from = parseKey(fromKey);
  const to = parseKey(toKey);
  if (!from || !to) return 0;

  const sameTonic = ((from.pc - to.pc + 12) % 12) === 0;

  // Same key or parallel major/minor → perfect flow.
  if (sameTonic) return 1.0;

  // Relative major/minor → one-step equivalent.
  const relPc = from.minor ? (from.pc + 3) % 12 : (from.pc + 9) % 12;
  if (to.pc === relPc && to.minor !== from.minor) return 0.85;

  const dist = circleOfFifthsDistance(from.pc, to.pc);
  const TABLE: Record<number, number> = { 0: 1.0, 1: 0.85, 2: 0.65, 3: 0.5, 4: 0.35, 5: 0.2, 6: 0.1 };
  return TABLE[dist] ?? 0.1;
}
