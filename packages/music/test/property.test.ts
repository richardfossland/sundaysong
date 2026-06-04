/**
 * Property/invariant fuzz for the music core. Deterministic: a fixed-seed PRNG
 * drives a capped number of iterations over generated chords and shifts. The
 * goal is the high-signal round-trip/identity laws of transposition and chord
 * parsing — laws the example-based tests assert only at hand-picked points.
 */

import { describe, expect, test } from "bun:test";
import {
  type Chord,
  parseChord,
  chordToString,
  transposeChord,
} from "../src/chord";

// ── deterministic PRNG (mulberry32) ───────────────────────────────────────────
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

const ROOTS = ["C", "C#", "Db", "D", "D#", "Eb", "E", "F", "F#", "Gb", "G", "G#", "Ab", "A", "A#", "Bb", "B"] as const;
const QUALITIES = ["", "m", "m7", "maj7", "sus4", "sus2", "7", "9", "dim", "aug", "m7b5", "add9", "6", "13"] as const;
const ITERS = 500;

function randomChordSymbol(r: () => number): string {
  const root = pick(r, ROOTS);
  const quality = pick(r, QUALITIES);
  const slash = r() < 0.3 ? "/" + pick(r, ROOTS) : "";
  return root + quality + slash;
}

describe("transposeChord — pitch-class laws (international dialect)", () => {
  test("shift by 0 is the identity", () => {
    const r = rng(1);
    for (let i = 0; i < ITERS; i++) {
      const c = parseChord(randomChordSymbol(r));
      expect(c).not.toBeNull();
      expect(transposeChord(c!, 0)).toEqual(c!);
    }
  });

  test("shift by +n then -n returns to the original pitch classes", () => {
    const r = rng(2);
    for (let i = 0; i < ITERS; i++) {
      const c = parseChord(randomChordSymbol(r))!;
      const n = Math.floor(r() * 49) - 24; // [-24, +24], including >|12|
      expect(transposeChord(transposeChord(c, n), -n)).toEqual(c);
    }
  });

  test("output root/bass are always valid pitch classes 0..11", () => {
    const r = rng(3);
    for (let i = 0; i < ITERS; i++) {
      const c = parseChord(randomChordSymbol(r))!;
      const n = Math.floor(r() * 200) - 100; // large, possibly negative
      const t = transposeChord(c, n);
      expect(Number.isInteger(t.root)).toBe(true);
      expect(t.root).toBeGreaterThanOrEqual(0);
      expect(t.root).toBeLessThanOrEqual(11);
      if (t.bass !== null) {
        expect(Number.isInteger(t.bass)).toBe(true);
        expect(t.bass).toBeGreaterThanOrEqual(0);
        expect(t.bass).toBeLessThanOrEqual(11);
      }
      expect(t.quality).toBe(c.quality); // quality is never reinterpreted
    }
  });

  test("transposing by a full octave (±12) is the identity", () => {
    const r = rng(4);
    for (let i = 0; i < ITERS; i++) {
      const c = parseChord(randomChordSymbol(r))!;
      expect(transposeChord(c, 12)).toEqual(c);
      expect(transposeChord(c, -12)).toEqual(c);
    }
  });
});

describe("parseChord / chordToString — serialization round-trip", () => {
  // parse -> serialize -> parse must preserve the parsed model exactly. Spelling
  // (sharp vs flat letters) may differ on the string, but the pitch-class model
  // is invariant.
  test("round-trip preserves the parsed Chord model under both spellings", () => {
    const r = rng(5);
    for (let i = 0; i < ITERS; i++) {
      const c = parseChord(randomChordSymbol(r))!;
      for (const preferFlats of [false, true]) {
        const s = chordToString(c, { preferFlats });
        const c2 = parseChord(s);
        expect(c2).not.toBeNull();
        expect(c2).toEqual(c as Chord);
      }
    }
  });

  test("round-trip composes with transposition (transpose then serialize then parse)", () => {
    const r = rng(6);
    for (let i = 0; i < ITERS; i++) {
      const c = parseChord(randomChordSymbol(r))!;
      const n = Math.floor(r() * 25) - 12;
      const t = transposeChord(c, n);
      const s = chordToString(t, { preferFlats: r() < 0.5 });
      expect(parseChord(s)).toEqual(t);
    }
  });
});
