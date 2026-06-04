/**
 * Tests for the balanced set composer (use case E — "build me a whole
 * service"). All offline: an in-memory candidate pool, no DB / embedder / LLM.
 *
 * These pin the real invariants the composer promises:
 *  - the set respects the requested target size (and grows to a duration);
 *  - consecutive BPM jumps never exceed the cap when a feasible order exists;
 *  - the realised energy trajectory tracks the requested arc shape;
 *  - adjacent key-flow is no worse than a naive theme-only order;
 *  - the major/minor mode balance is pulled toward the requested ratio;
 *  - composition is deterministic for a fixed input.
 */

import { describe, expect, test } from "bun:test";

import { composeSet, type SetCandidate } from "../src/setComposer";
import { scoreCandidate, type Candidate, type RecommendRequest } from "../src/recommend";
import { keyCompatibilityScore, parseKey } from "@sundaysong/music";

// ── Fixtures ────────────────────────────────────────────────────────────────

let _id = 0;
function cand(partial: Partial<SetCandidate>): SetCandidate {
  _id++;
  return {
    id: partial.id ?? `s${_id}`,
    canonical_title: partial.canonical_title ?? `Song ${_id}`,
    themes: partial.themes ?? [],
    bible_refs: partial.bible_refs ?? [],
    popularity_score: partial.popularity_score ?? 10,
    language: partial.language ?? "en",
    semantic_score: partial.semantic_score ?? 0.5,
    key: partial.key ?? null,
    bpm: partial.bpm ?? null,
    suggested_key: partial.key ?? null,
    duration_sec: partial.duration_sec ?? null,
  };
}

/** A varied pool covering keys around the circle, a range of BPMs and themes. */
function pool(): SetCandidate[] {
  return [
    cand({ id: "grace-c", canonical_title: "Grace in C", themes: ["grace"], key: "C", bpm: 72, semantic_score: 0.8 }),
    cand({ id: "praise-g", canonical_title: "Praise in G", themes: ["praise", "celebration"], key: "G", bpm: 120, semantic_score: 0.5 }),
    cand({ id: "still-am", canonical_title: "Be Still in Am", themes: ["stillness", "prayer"], key: "Am", bpm: 66, semantic_score: 0.6 }),
    cand({ id: "joy-d", canonical_title: "Joy in D", themes: ["joy", "victory"], key: "D", bpm: 128, semantic_score: 0.4 }),
    cand({ id: "rest-f", canonical_title: "Rest in F", themes: ["rest", "communion"], key: "F", bpm: 70, semantic_score: 0.55 }),
    cand({ id: "shout-a", canonical_title: "Shout in A", themes: ["shout", "freedom"], key: "A", bpm: 132, semantic_score: 0.45 }),
    cand({ id: "grace-em", canonical_title: "Grace in Em", themes: ["grace", "surrender"], key: "Em", bpm: 76, semantic_score: 0.7 }),
    cand({ id: "tritone-fs", canonical_title: "Far Key", themes: ["grace"], key: "F#", bpm: 90, semantic_score: 0.35 }),
  ];
}

// ── 1. Target size / duration ─────────────────────────────────────────────────

describe("target size & duration", () => {
  test("respects an explicit target_size", () => {
    const res = composeSet({ theme: "grace", target_size: 3 }, pool());
    expect(res.slots).toHaveLength(3);
  });

  test("defaults to a reasonable size when none given", () => {
    const res = composeSet({ theme: "grace" }, pool());
    expect(res.slots.length).toBeGreaterThan(0);
    expect(res.slots.length).toBeLessThanOrEqual(pool().length);
  });

  test("clamps target_size to the pool size", () => {
    const res = composeSet({ theme: "grace", target_size: 99 }, pool());
    expect(res.slots).toHaveLength(pool().length);
  });

  test("grows to a target duration using known song lengths", () => {
    // Four 5-minute songs → ~20 min should pick about 4.
    const songs = [
      cand({ id: "a", duration_sec: 300, semantic_score: 0.9 }),
      cand({ id: "b", duration_sec: 300, semantic_score: 0.8 }),
      cand({ id: "c", duration_sec: 300, semantic_score: 0.7 }),
      cand({ id: "d", duration_sec: 300, semantic_score: 0.6 }),
      cand({ id: "e", duration_sec: 300, semantic_score: 0.5 }),
    ];
    const res = composeSet({ theme: "grace", target_duration_min: 20 }, songs);
    expect(res.slots).toHaveLength(4);
    expect(res.total_minutes_estimate).toBe(20);
  });

  test("target_size takes precedence over target_duration_min", () => {
    const res = composeSet({ theme: "grace", target_size: 2, target_duration_min: 60 }, pool());
    expect(res.slots).toHaveLength(2);
  });

  test("empty pool yields an empty, explained result", () => {
    const res = composeSet({ theme: "grace", target_size: 4 }, []);
    expect(res.slots).toHaveLength(0);
    expect(res.summary).toContain("No catalog songs");
  });

  test("language filter restricts the pool", () => {
    const mixed = [
      cand({ id: "en1", language: "en", semantic_score: 0.9 }),
      cand({ id: "no1", language: "no", semantic_score: 0.9 }),
    ];
    const res = composeSet({ theme: "grace", language: "no", target_size: 5 }, mixed);
    expect(res.slots.every((s) => s.song_id === "no1")).toBe(true);
    expect(res.slots).toHaveLength(1);
  });
});

// ── 2. Tempo smoothness (the hard constraint) ──────────────────────────────────

describe("tempo smoothness", () => {
  test("never exceeds the BPM cap when a feasible order exists", () => {
    // BPMs 60,70,80,90,100 — adjacent steps of 10 are feasible within a cap of 15.
    const songs = [60, 100, 70, 90, 80].map((b, i) =>
      cand({ id: `t${i}`, bpm: b, key: "C", semantic_score: 0.5 }),
    );
    const res = composeSet(
      { theme: "x", target_size: 5, constraints: { max_bpm_jump: 15 } },
      songs,
    );
    const bpms = res.slots.map((s) => s.bpm!);
    for (let i = 1; i < bpms.length; i++) {
      expect(Math.abs(bpms[i]! - bpms[i - 1]!)).toBeLessThanOrEqual(15);
    }
    expect(res.tempo_violations).toBe(0);
  });

  test("flags a violation when no smooth ordering is possible", () => {
    // Two songs 60 BPM apart with a cap of 10 — the jump is unavoidable.
    const songs = [cand({ id: "lo", bpm: 60, key: "C" }), cand({ id: "hi", bpm: 130, key: "C" })];
    const res = composeSet({ theme: "x", target_size: 2, constraints: { max_bpm_jump: 10 } }, songs);
    expect(res.tempo_violations).toBe(1);
    expect(res.slots.some((s) => s.tempo_violation)).toBe(true);
  });

  test("unknown BPMs are exempt from the cap (no false violation)", () => {
    const songs = [cand({ id: "a", bpm: null, key: "C" }), cand({ id: "b", bpm: null, key: "G" })];
    const res = composeSet({ theme: "x", target_size: 2, constraints: { max_bpm_jump: 5 } }, songs);
    expect(res.tempo_violations).toBe(0);
  });
});

// ── 3. Energy arc tracking ──────────────────────────────────────────────────────

describe("energy arc tracking", () => {
  test("rising arc places lower-energy songs before higher-energy ones (trend)", () => {
    const res = composeSet({ theme: "x", arc: "rising", target_size: 5 }, pool());
    const energies = res.trajectory.energy;
    // The first half's average energy should be below the second half's.
    const mid = Math.floor(energies.length / 2);
    const firstAvg = avg(energies.slice(0, mid));
    const secondAvg = avg(energies.slice(mid));
    expect(secondAvg).toBeGreaterThan(firstAvg);
  });

  test("realised energy tracks the requested arc better than the reverse arc", () => {
    const p = pool();
    const rising = composeSet({ theme: "x", arc: "rising", target_size: 6 }, p);
    // Deviation of the rising set's energy from the rising target...
    const devRising = trajectoryDeviation(rising.trajectory.energy, rising.trajectory.target_energy);
    // ...should be smaller than measuring the same realised energy against a
    // reflective (downward) target — i.e. the composer genuinely shaped it.
    const reflective = composeSet({ theme: "x", arc: "reflective", target_size: 6 }, p);
    const devReflectiveAgainstRising = trajectoryDeviation(
      reflective.trajectory.energy,
      rising.trajectory.target_energy,
    );
    expect(devRising).toBeLessThan(devReflectiveAgainstRising);
  });

  test("no arc requested → no target trajectory", () => {
    const res = composeSet({ theme: "x", target_size: 4 }, pool());
    expect(res.trajectory.target_energy).toHaveLength(0);
  });
});

// ── 4. Key-flow continuity ──────────────────────────────────────────────────────

describe("key-flow continuity", () => {
  test("adjacent key-flow is no worse than a naive theme-only order", () => {
    const p = pool();
    const req: ComposeReq = { theme: "grace", target_size: 5 };
    const composed = composeSet(req, p);

    // Naive order: pure relevance ranking, same size, no flow optimisation.
    const naive = naiveThemeOrder(req, p, composed.slots.length);

    const composedFlow = totalAdjacentKeyFlow(composed.trajectory.keys);
    const naiveFlow = totalAdjacentKeyFlow(naive);
    expect(composedFlow).toBeGreaterThanOrEqual(naiveFlow);
  });

  test("opener has no key-flow penalty (flows from nothing)", () => {
    const res = composeSet({ theme: "grace", target_size: 3 }, pool());
    // The first slot's reason should not contain a 'flows:' clause.
    expect(res.slots[0]!.reason.includes("flows:")).toBe(false);
  });
});

// ── 5. Mode balance ─────────────────────────────────────────────────────────────

describe("mode balance", () => {
  function modePool(): SetCandidate[] {
    return [
      cand({ id: "maj1", key: "C", bpm: 90, semantic_score: 0.6 }),
      cand({ id: "maj2", key: "G", bpm: 90, semantic_score: 0.6 }),
      cand({ id: "maj3", key: "D", bpm: 90, semantic_score: 0.6 }),
      cand({ id: "maj4", key: "A", bpm: 90, semantic_score: 0.6 }),
      cand({ id: "min1", key: "Am", bpm: 90, semantic_score: 0.6 }),
      cand({ id: "min2", key: "Em", bpm: 90, semantic_score: 0.6 }),
      cand({ id: "min3", key: "Dm", bpm: 90, semantic_score: 0.6 }),
      cand({ id: "min4", key: "Bm", bpm: 90, semantic_score: 0.6 }),
    ];
  }

  test("a 50/50 target pulls the set toward balance vs an unconstrained set", () => {
    const balanced = composeSet(
      { theme: "x", target_size: 4, constraints: { major_ratio: 0.5 } },
      modePool(),
    );
    // With a 50% target over 4 songs, expect 2 major / 2 minor (ratio 0.5).
    expect(balanced.major_ratio).toBe(0.5);
  });

  test("an all-major target favours major keys", () => {
    const res = composeSet(
      { theme: "x", target_size: 4, constraints: { major_ratio: 1.0 } },
      modePool(),
    );
    expect(res.major_ratio).toBe(1);
  });

  test("an all-minor target favours minor keys", () => {
    const res = composeSet(
      { theme: "x", target_size: 4, constraints: { major_ratio: 0.0 } },
      modePool(),
    );
    expect(res.major_ratio).toBe(0);
  });

  test("major_ratio is null when no keys are known", () => {
    const songs = [cand({ id: "a", key: null }), cand({ id: "b", key: null })];
    const res = composeSet({ theme: "x", target_size: 2, constraints: { major_ratio: 0.5 } }, songs);
    expect(res.major_ratio).toBeNull();
  });
});

// ── 6. Determinism & invariants ─────────────────────────────────────────────────

describe("determinism & general invariants", () => {
  test("identical input yields an identical composition", () => {
    const a = composeSet({ theme: "grace", arc: "rising", target_size: 5, constraints: { major_ratio: 0.5, max_bpm_jump: 20 } }, pool());
    const b = composeSet({ theme: "grace", arc: "rising", target_size: 5, constraints: { major_ratio: 0.5, max_bpm_jump: 20 } }, pool());
    expect(a.slots.map((s) => s.song_id)).toEqual(b.slots.map((s) => s.song_id));
    expect(a.summary).toBe(b.summary);
  });

  test("no song is placed twice", () => {
    const res = composeSet({ theme: "grace", target_size: 8 }, pool());
    const ids = res.slots.map((s) => s.song_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every slot carries a non-empty reason and an in-range position", () => {
    const res = composeSet({ theme: "grace", arc: "rising", target_size: 5 }, pool());
    res.slots.forEach((s, i) => {
      expect(s.position).toBe(i);
      expect(s.reason.length).toBeGreaterThan(0);
    });
  });

  test("trajectory arrays line up with the slot count", () => {
    const res = composeSet({ theme: "grace", arc: "rising", target_size: 5 }, pool());
    const n = res.slots.length;
    expect(res.trajectory.energy).toHaveLength(n);
    expect(res.trajectory.keys).toHaveLength(n);
    expect(res.trajectory.bpm).toHaveLength(n);
  });

  test("a single-candidate pool composes a one-slot set", () => {
    const res = composeSet({ theme: "grace", target_size: 4 }, [cand({ id: "only", key: "C", bpm: 80 })]);
    expect(res.slots).toHaveLength(1);
    expect(res.slots[0]!.song_id).toBe("only");
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

interface ComposeReq {
  theme?: string;
  target_size?: number;
}

function avg(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sum of |realised − target| across the trajectory. */
function trajectoryDeviation(realised: number[], target: number[]): number {
  let d = 0;
  for (let i = 0; i < realised.length; i++) d += Math.abs(realised[i]! - (target[i] ?? 0));
  return d;
}

/** Sum of adjacent key-compatibility scores along a key sequence. */
function totalAdjacentKeyFlow(keys: (string | null)[]): number {
  let total = 0;
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1] ? parseKey(keys[i - 1]!) : null;
    const b = keys[i] ? parseKey(keys[i]!) : null;
    if (a && b) total += keyCompatibilityScore(a, b).score;
  }
  return total;
}

/** A naive relevance-only ordering's key sequence (the baseline to beat). */
function naiveThemeOrder(req: ComposeReq, candidates: SetCandidate[], size: number): (string | null)[] {
  const recReq: RecommendRequest = { theme: req.theme };
  return [...candidates]
    .map((c) => ({ c, s: scoreCandidate(recReq, c as Candidate).score }))
    .sort((a, b) => b.s - a.s || (a.c.id < b.c.id ? -1 : 1))
    .slice(0, size)
    .map((x) => x.c.key ?? null);
}
