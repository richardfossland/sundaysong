/**
 * Property/invariant fuzz for the shared text-folding + idempotency-key cores.
 * Deterministic: fixed-seed PRNG over a Nordic-flavoured alphabet, capped at
 * 500 iterations. These two helpers are load-bearing — folding must be a true
 * normalizer (idempotent, stable under tokenize) and the usage idempotency key
 * must be stable per (service,item) and distinct across distinct pairs, or
 * retried usage events double-count.
 */

import { describe, expect, test } from "bun:test";
import { foldNordic, tokenize } from "../src/text";
import { makeUsageIdempotencyKey } from "../src/schemas";

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

// A mix of plain ASCII, Nordic specials (both cases), combining-accented and
// precomposed letters, ß, digits, and separators.
const CHARS = [
  ..."abcdefghijABCDEFGHIJ0123456789 -_,.",
  "ø", "Ø", "æ", "Æ", "å", "Å", "ß",
  "é", "É", "ü", "Ü", "ä", "ö", "ñ", "ô",
  "Når", "Frälsare", "Øye",
] as const;
const ITERS = 500;

function randomText(r: () => number): string {
  const len = Math.floor(r() * 24);
  let s = "";
  for (let i = 0; i < len; i++) s += pick(r, CHARS);
  return s;
}

describe("foldNordic — normalizer laws", () => {
  test("idempotent: folding a folded string is a fixed point", () => {
    const r = rng(21);
    for (let i = 0; i < ITERS; i++) {
      const s = randomText(r);
      const once = foldNordic(s);
      expect(foldNordic(once)).toBe(once);
    }
  });

  test("output contains no uppercase letters and no surviving Nordic specials", () => {
    const r = rng(22);
    for (let i = 0; i < ITERS; i++) {
      const out = foldNordic(randomText(r));
      expect(out).toBe(out.toLowerCase());
      expect(/[øæåßØÆÅ]/.test(out)).toBe(false);
    }
  });

  test("tokenize agrees with folding (folding is stable under tokenization)", () => {
    const r = rng(23);
    for (let i = 0; i < ITERS; i++) {
      const s = randomText(r);
      // every token is already fully folded (a fixed point of foldNordic)
      for (const tok of tokenize(s)) {
        expect(foldNordic(tok)).toBe(tok);
        expect(/^[a-z0-9]+$/.test(tok)).toBe(true);
      }
    }
  });
});

describe("makeUsageIdempotencyKey — dedupe contract", () => {
  const IDS = ["s1", "s2", "s3", "i1", "i2", "i3", "abc", "x", "service-1"] as const;

  test("stable: same (service,item) always yields the same key", () => {
    const r = rng(31);
    for (let i = 0; i < ITERS; i++) {
      const svc = pick(r, IDS);
      const item = pick(r, IDS);
      expect(makeUsageIdempotencyKey(svc, item)).toBe(makeUsageIdempotencyKey(svc, item));
    }
  });

  test("distinct: distinct (service,item) pairs yield distinct keys (no collisions)", () => {
    // Exhaustive over the small id space — this is the property that guards
    // against double-counting two genuinely different service items.
    const seen = new Map<string, string>();
    for (const svc of IDS) {
      for (const item of IDS) {
        const key = makeUsageIdempotencyKey(svc, item);
        const pair = `${svc}|${item}`;
        for (const [otherPair, otherKey] of seen) {
          if (otherKey === key) {
            throw new Error(`collision: ${pair} and ${otherPair} both -> ${key}`);
          }
        }
        seen.set(pair, key);
      }
    }
    expect(seen.size).toBe(IDS.length * IDS.length);
  });
});
