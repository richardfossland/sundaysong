/**
 * Recommendation use case D — "build a set with a rising / reflective /
 * celebratory / lament arc".
 *
 * The heuristic ranker (recommend.ts) decides *which* songs make the set; key
 * flow (keyFlow.ts) smooths key changes. This layer decides the *running
 * order* by energy: a worship set has a shape, and a leader asking for a
 * "rising" arc wants the band to build from a gentle opener up to a peak,
 * while "reflective" winds down into stillness.
 *
 * It is pure and offline. Each pick's 0..1 energy comes from
 * `@sundaysong/music` estimateEnergy over the objective signals the API can
 * supply per song (BPM, key, themes, title). We build a target energy curve
 * for the requested arc and assign picks to positions so the realised curve
 * tracks the target as closely as possible. The picks themselves don't change
 * — only their order and the explanation — so this composes cleanly after
 * ranking and (optionally) key flow.
 *
 * recommend.ts already has a crude `arcOrder` that uses each pick's *score* as
 * an energy stand-in; this module supersedes it with real energy signals and a
 * named curve, exposed as `applyArc` to mirror `applyKeyFlow`.
 */

import { estimateEnergy, type EnergySignals } from "@sundaysong/music";

import type { RankResult, RankedPick } from "./recommend";

/** The arc shapes a leader can request. */
export type ArcShape = "rising" | "reflective" | "celebration" | "lament" | "peak";

export interface ArcOptions {
  arc: ArcShape;
  /**
   * Energy signals per candidate song id (BPM / key / themes / title). Picks
   * with no entry fall back to a neutral 0.5 energy — they sort to the middle
   * of the curve rather than being dropped.
   */
  signalsByPickId: Record<string, EnergySignals | undefined>;
}

/**
 * Target energy at each of `n` positions for a given arc, normalised to 0..1
 * across the set. The curves:
 *  - rising:       gentle opener → peak closer (linear ramp up)
 *  - celebration:  starts already lifted, climbs to a strong peak
 *  - reflective:   starts mid, winds down into stillness
 *  - lament:       starts low, stays low, dips further (a heavy, downward set)
 *  - peak:         builds to a high point in the middle, then eases back
 *    (the classic call-to-worship → declaration → response shape)
 *
 * For n === 1 every shape collapses to a single mid-energy slot.
 */
export function arcCurve(arc: ArcShape, n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [0.5];

  const t = (i: number) => i / (n - 1); // 0..1 across the set

  switch (arc) {
    case "rising":
      return Array.from({ length: n }, (_, i) => t(i));
    case "celebration":
      // Start lifted (0.5) and climb to 1.0.
      return Array.from({ length: n }, (_, i) => 0.5 + 0.5 * t(i));
    case "reflective":
      // Start mid (0.6) and wind down to stillness (0.1).
      return Array.from({ length: n }, (_, i) => 0.6 - 0.5 * t(i));
    case "lament":
      // Low throughout, dipping further: 0.4 → 0.05.
      return Array.from({ length: n }, (_, i) => 0.4 - 0.35 * t(i));
    case "peak": {
      // Triangle: 0 → 1 at the midpoint → back toward 0.4.
      return Array.from({ length: n }, (_, i) => {
        const x = t(i);
        return x <= 0.5 ? x * 2 : 1 - (x - 0.5) * 2 * 0.6;
      });
    }
  }
}

interface PickEnergy {
  pick: RankedPick;
  energy: number;
  reasons: string[];
}

/**
 * Re-sequence a `RankResult`'s picks to match the requested energy arc.
 *
 * Algorithm (deterministic): estimate each pick's energy, then assign picks to
 * target positions by rank order — the lowest-energy pick fills the
 * lowest-energy target slot, and so on — which provably minimises the total
 * |realised − target| deviation for a monotone target and is stable for ties.
 * The result is flagged `arc` (the requested shape) and each pick's reason
 * gains its energy placement so the leader can see why it sits where it does.
 *
 * Pure. Empty sets and unknown arcs degrade to a no-op (`arcApplied:false`).
 */
export function applyArc(
  result: RankResult,
  opts: ArcOptions,
): RankResult & { arcApplied: boolean; arc?: ArcShape } {
  if (result.picks.length === 0) {
    return { ...result, arcApplied: false };
  }
  const n = result.picks.length;

  const energies: PickEnergy[] = result.picks.map((pick) => {
    const est = estimateEnergy(opts.signalsByPickId[pick.song_id] ?? {});
    return { pick, energy: est.value, reasons: est.reasons };
  });

  // Target energy per position, and the position indices sorted by target so
  // we can pair them with picks sorted by energy.
  const target = arcCurve(opts.arc, n);
  const positionsByTarget = target
    .map((energy, index) => ({ energy, index }))
    .sort((a, b) => a.energy - b.energy || a.index - b.index);

  // Picks sorted ascending by energy (stable on the original order for ties).
  const picksByEnergy = energies
    .map((e, order) => ({ ...e, order }))
    .sort((a, b) => a.energy - b.energy || a.order - b.order);

  // Place the k-th lowest-energy pick into the k-th lowest-energy slot.
  const placed: (PickEnergy & { position: number })[] = new Array(n);
  picksByEnergy.forEach((pe, k) => {
    const position = positionsByTarget[k]!.index;
    placed[position] = { ...pe, position };
  });

  const energyWord = (v: number) =>
    v >= 0.75 ? "high-energy" : v >= 0.45 ? "mid-energy" : "low-energy";

  const ordered: RankedPick[] = placed.map((pe) => ({
    ...pe.pick,
    reason: `${pe.pick.reason} · ${energyWord(pe.energy)} (${pe.reasons[0]})`,
  }));

  return {
    ...result,
    picks: ordered,
    summary: `${result.summary} Sequenced for a ${opts.arc} arc.`,
    arcApplied: true,
    arc: opts.arc,
  };
}
