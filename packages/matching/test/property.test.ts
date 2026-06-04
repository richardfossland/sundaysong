/**
 * Property/invariant fuzz for the cross-language matcher. Deterministic: a
 * fixed-seed PRNG builds random MatchSong pairs/pools, capped at 500 iterations.
 * Pins the scoring contract the UI/admin flow relies on: confidence is always a
 * clean probability, scoring is deterministic, recommendation tracks the
 * thresholds, and proposeCandidates yields a stable best-first order.
 */

import { describe, expect, test } from "bun:test";
import { scoreTranslationCandidate, proposeCandidates } from "../src/candidates";
import type { MatchSong } from "../src/types";

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;

const LANGS = ["en", "no", "nb", "nn", "sv", "da", "de"] as const;
const THEMES = ["grace", "cross", "hope", "praise", "worship"] as const;
const REFS = ["John 3:16", "Ps 23", "Rom 8", "Isa 53"] as const;
const COMPOSERS = ["c1", "c2", "c3", "c4"] as const;
const TITLES = [
  "Amazing Grace", "Underfull nade", "Halleluja", "Hallelujah",
  "Naar mitt oye", "Når mitt øye", "Frälsare", "Holy Holy", "Stille natt",
] as const;
const IDS = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const ITERS = 500;

function maybe<T>(r: () => number, v: T): T | null {
  return r() < 0.5 ? v : null;
}

function randomSong(r: () => number, id: string): MatchSong {
  return {
    id,
    canonical_title: pick(r, TITLES),
    language: pick(r, LANGS),
    themes: Array.from({ length: Math.floor(r() * 3) }, () => pick(r, THEMES)),
    bible_refs: Array.from({ length: Math.floor(r() * 3) }, () => pick(r, REFS)),
    year_first_published: r() < 0.6 ? 1700 + Math.floor(r() * 320) : null,
    composer_ids: Array.from({ length: Math.floor(r() * 2) }, () => pick(r, COMPOSERS)),
    ccli_song_id: maybe(r, "ccli-" + Math.floor(r() * 5)),
    tono_work_id: maybe(r, "tono-" + Math.floor(r() * 5)),
  };
}

describe("scoreTranslationCandidate — scoring contract", () => {
  test("confidence is always a clean probability in [0,1]", () => {
    const r = rng(11);
    for (let i = 0; i < ITERS; i++) {
      const a = randomSong(r, pick(r, IDS));
      const b = randomSong(r, pick(r, IDS));
      const { confidence } = scoreTranslationCandidate(a, b);
      expect(Number.isFinite(confidence)).toBe(true);
      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(1);
    }
  });

  test("scoring is deterministic — same inputs give an identical result", () => {
    const r = rng(12);
    for (let i = 0; i < ITERS; i++) {
      const a = randomSong(r, pick(r, IDS));
      const b = randomSong(r, pick(r, IDS));
      expect(scoreTranslationCandidate(a, b)).toEqual(scoreTranslationCandidate(a, b));
    }
  });

  test("same normalized language always rejects with zero confidence", () => {
    const r = rng(13);
    for (let i = 0; i < ITERS; i++) {
      const a = randomSong(r, "x");
      const b = randomSong(r, "y");
      // Force the same Norwegian family (nb/nn/no collapse to one language).
      a.language = pick(r, ["no", "nb", "nn"]);
      b.language = pick(r, ["no", "nb", "nn"]);
      const res = scoreTranslationCandidate(a, b);
      expect(res.confidence).toBe(0);
      expect(res.recommendation).toBe("reject");
    }
  });

  test("recommendation tracks the confidence thresholds", () => {
    const r = rng(14);
    for (let i = 0; i < ITERS; i++) {
      const a = randomSong(r, pick(r, IDS));
      const b = randomSong(r, pick(r, IDS));
      const { confidence, recommendation } = scoreTranslationCandidate(a, b);
      if (recommendation === "auto_link") expect(confidence).toBeGreaterThanOrEqual(0.8);
      else if (recommendation === "propose") {
        expect(confidence).toBeGreaterThanOrEqual(0.45);
        expect(confidence).toBeLessThan(0.8);
      } else {
        expect(confidence).toBeLessThan(0.45);
      }
    }
  });
});

describe("proposeCandidates — ranking contract", () => {
  test("results are sorted best-first with a deterministic tie-break, never include the target", () => {
    const r = rng(15);
    for (let i = 0; i < 200; i++) {
      const target = randomSong(r, "TARGET");
      const pool = Array.from({ length: 6 }, (_, k) => randomSong(r, "p" + k));
      const out = proposeCandidates(target, pool);
      // target is never proposed against itself
      expect(out.every((c) => c.b_id !== "TARGET")).toBe(true);
      // every survivor clears the propose floor and is not a reject
      for (const c of out) {
        expect(c.confidence).toBeGreaterThanOrEqual(0.45);
        expect(c.recommendation).not.toBe("reject");
      }
      // sorted by confidence desc, then b_id asc
      for (let k = 1; k < out.length; k++) {
        const prev = out[k - 1]!;
        const cur = out[k]!;
        const ok = prev.confidence > cur.confidence ||
          (prev.confidence === cur.confidence && prev.b_id.localeCompare(cur.b_id) <= 0);
        expect(ok).toBe(true);
      }
    }
  });

  test("ranking is invariant under input pool permutation", () => {
    const r = rng(16);
    for (let i = 0; i < 100; i++) {
      const target = randomSong(r, "T");
      const pool = Array.from({ length: 6 }, (_, k) => randomSong(r, "p" + k));
      const shuffled = [...pool].reverse();
      const a = proposeCandidates(target, pool).map((c) => `${c.b_id}:${c.confidence}`);
      const b = proposeCandidates(target, shuffled).map((c) => `${c.b_id}:${c.confidence}`);
      expect(a).toEqual(b);
    }
  });
});
