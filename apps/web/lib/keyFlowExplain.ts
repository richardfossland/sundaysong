/**
 * Pure, framework-free explainer for the /recommendations/flow page.
 *
 * Given a "flow from" key and a successor key, classify WHY the successor flows
 * — same key, relative major/minor, parallel major/minor, a circle-of-fifths
 * neighbour, or a more distant move — and produce a short human explanation and
 * a compact badge. This is the "explainer" surface the flow page is built
 * around; the actual ranking still happens server-side in
 * POST /v1/recommend/after (packages/music keyFlow).
 *
 * Builds on the existing music engine — it does NOT re-derive the theory:
 *  - parseKey / keyToString          (packages/music keys)
 *  - keyCompatibilityScore           (the relationship ladder + reason)
 *  - circleOfFifthsDistance          (the ring geometry)
 *  - relativePc                      (relative major/minor tonic)
 *
 * Kept out of the React component so it can be unit-tested under `bun test`
 * with no DOM, API or network, the same offline-first discipline the rest of
 * the web app follows.
 */

import {
  parseKey,
  keyToString,
  keyCompatibilityScore,
  circleOfFifthsDistance,
  relativePc,
} from "@sundaysong/music";

/** The relationship category between a from-key and a successor key. */
export type FlowRelation =
  | "same"
  | "relative"
  | "parallel"
  | "neighbour"
  | "near"
  | "distant"
  | "unknown";

export interface FlowExplanation {
  /** Coarse relationship category — drives colour / grouping in the UI. */
  relation: FlowRelation;
  /** A one or two word label, e.g. "Same key", "Relative minor". */
  label: string;
  /** A short symbol/badge, e.g. "=", "rel", "‖", "+1". */
  badge: string;
  /** Circle-of-fifths distance 0..6, or null when a key couldn't be parsed. */
  distance: number | null;
  /** A full sentence the UI can show under each pick. */
  detail: string;
}

/**
 * Classify and explain how `toKey` flows after `fromKey`.
 *
 * Both keys are display strings ("G", "Em", "Bb", "F#m"). When either is
 * missing or unparseable we degrade to the `"unknown"` relation with an honest
 * message rather than guessing — the same safest-degradation rule the server
 * scorer uses.
 *
 * The category ladder mirrors `keyCompatibilityScore` so the UI never disagrees
 * with the engine that ranked the list:
 *   same → relative → parallel → neighbour (1 step) → near (2–3) → distant (4+).
 */
export function explainFlow(
  fromKey: string | null | undefined,
  toKey: string | null | undefined,
): FlowExplanation {
  const from = fromKey ? parseKey(fromKey) : null;
  const to = toKey ? parseKey(toKey) : null;

  if (!from || !to) {
    return {
      relation: "unknown",
      label: "Key unknown",
      badge: "?",
      distance: null,
      detail: !to
        ? "No key data for this song, so it was matched on tempo alone."
        : "We don't know the key you're flowing from, so this is a tempo-only match.",
    };
  }

  const fromStr = keyToString(from);
  const toStr = keyToString(to);
  const sameTonic = ((from.pc - to.pc) % 12 + 12) % 12 === 0;
  const dist = circleOfFifthsDistance(from.pc, to.pc);

  if (sameTonic && from.minor === to.minor) {
    return {
      relation: "same",
      label: "Same key",
      badge: "=",
      distance: 0,
      detail: `Stays in ${toStr} — no modulation at all, the smoothest possible move.`,
    };
  }

  // Relative major/minor: different tonic, shared key signature.
  if (to.pc === relativePc(from) && to.minor !== from.minor) {
    const which = to.minor ? "minor" : "major";
    return {
      relation: "relative",
      label: `Relative ${which}`,
      badge: "rel",
      distance: dist,
      detail: `${toStr} is the relative ${which} of ${fromStr} — same notes, just a new home chord, so the move is seamless.`,
    };
  }

  // Parallel major/minor: same tonic, opposite mode.
  if (sameTonic && from.minor !== to.minor) {
    const which = to.minor ? "minor" : "major";
    return {
      relation: "parallel",
      label: `Parallel ${which}`,
      badge: "‖",
      distance: dist,
      detail: `${toStr} is the parallel ${which} of ${fromStr} — same tonic, flipped mode; a familiar colour shift the ear follows easily.`,
    };
  }

  if (dist === 1) {
    return {
      relation: "neighbour",
      label: "A fifth away",
      badge: "+1",
      distance: 1,
      detail: `${toStr} sits one step from ${fromStr} on the circle of fifths — the classic IV/V neighbour, a single comfortable step.`,
    };
  }

  if (dist <= 3) {
    return {
      relation: "near",
      label: `${dist} steps away`,
      badge: `+${dist}`,
      distance: dist,
      detail: `${toStr} is ${dist} steps from ${fromStr} on the circle of fifths — a noticeable but playable modulation.`,
    };
  }

  return {
    relation: "distant",
    label: dist === 6 ? "Tritone away" : `${dist} steps away`,
    badge: `+${dist}`,
    distance: dist,
    detail:
      dist === 6
        ? `${toStr} is a tritone from ${fromStr} — the far side of the circle, the most jarring change. Use it as a deliberate lift.`
        : `${toStr} is ${dist} steps from ${fromStr} on the circle of fifths — a distant change you'll want to bridge intentionally.`,
  };
}

/**
 * The raw 0..1 key-flow score the engine would assign this move, exposed so the
 * UI can show a confidence bar that matches the server ranking. Returns null
 * when either key is unknown (we never invent a score).
 */
export function flowScore(
  fromKey: string | null | undefined,
  toKey: string | null | undefined,
): number | null {
  const from = fromKey ? parseKey(fromKey) : null;
  const to = toKey ? parseKey(toKey) : null;
  if (!from || !to) return null;
  return keyCompatibilityScore(from, to).score;
}

// ── Circle-of-fifths geometry (for the optional SVG visual) ──────────────────

/**
 * The twelve major-key tonics in clockwise circle-of-fifths order, starting
 * from C at the top (12 o'clock). Index = clock position 0..11. These are the
 * conventional spellings musicians read on the circle.
 */
export const CIRCLE_MAJORS: readonly string[] = [
  "C", "G", "D", "A", "E", "B", "F#", "Db", "Ab", "Eb", "Bb", "F",
];

export interface CircleNode {
  /** Display key, e.g. "C". */
  key: string;
  /** Clock position 0..11 (0 = top, clockwise). */
  position: number;
  /** Fractional angle in radians, 0 at top, clockwise. */
  angle: number;
}

/**
 * The twelve circle nodes with their angles, for laying out an SVG ring. Pure
 * geometry — no DOM. Angle 0 points up; we go clockwise, so the SVG caller maps
 * (x = cx + r·sin θ, y = cy − r·cos θ).
 */
export function circleNodes(): CircleNode[] {
  return CIRCLE_MAJORS.map((key, position) => ({
    key,
    position,
    angle: (position / 12) * 2 * Math.PI,
  }));
}

/**
 * The clock position 0..11 of a key on the circle of fifths, ignoring mode
 * (a minor key maps to the position of its tonic's major spelling). Returns
 * null when the key can't be parsed. Enharmonic equivalents fold onto the
 * conventional circle spelling (e.g. "Gb" → the F# position).
 */
export function circlePositionOf(keyName: string | null | undefined): number | null {
  const k = keyName ? parseKey(keyName) : null;
  if (!k) return null;
  // Map tonic pitch class to its clock position via the circle order.
  const order = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
  const idx = order.indexOf(((k.pc % 12) + 12) % 12);
  return idx < 0 ? null : idx;
}
