import { describe, expect, test } from "bun:test";
import {
  circleOfFifthsDistance,
  relativePc,
  keyCompatibilityScore,
} from "../src/keyFlow";
import { parseKey, type Key } from "../src/keys";

const k = (s: string): Key => {
  const key = parseKey(s);
  if (!key) throw new Error(`bad test key: ${s}`);
  return key;
};

describe("circleOfFifthsDistance", () => {
  test("identical tonic is zero", () => {
    expect(circleOfFifthsDistance(0, 0)).toBe(0); // C↔C
  });

  test("a perfect fifth apart is one step", () => {
    expect(circleOfFifthsDistance(0, 7)).toBe(1); // C↔G
    expect(circleOfFifthsDistance(0, 5)).toBe(1); // C↔F
  });

  test("a whole tone apart is two steps", () => {
    expect(circleOfFifthsDistance(0, 2)).toBe(2); // C↔D (C→G→D)
  });

  test("the tritone is the maximum, six steps", () => {
    expect(circleOfFifthsDistance(0, 6)).toBe(6); // C↔F#
  });

  test("wraps the short way around the circle", () => {
    // Bb (pc 10) is one step counter-clockwise from F (pc 5): F→Bb.
    expect(circleOfFifthsDistance(5, 10)).toBe(1);
  });

  test("is symmetric", () => {
    expect(circleOfFifthsDistance(2, 9)).toBe(circleOfFifthsDistance(9, 2));
  });
});

describe("relativePc", () => {
  test("relative minor of C major is A (pc 9)", () => {
    expect(relativePc(k("C"))).toBe(9);
  });

  test("relative major of A minor is C (pc 0)", () => {
    expect(relativePc(k("Am"))).toBe(0);
  });

  test("relative minor of G major is E (pc 4)", () => {
    expect(relativePc(k("G"))).toBe(4);
  });
});

describe("keyCompatibilityScore", () => {
  test("same key scores 1.0", () => {
    const r = keyCompatibilityScore(k("D"), k("D"));
    expect(r.score).toBe(1);
    expect(r.reason.toLowerCase()).toContain("same key");
  });

  test("relative minor scores 0.9 and names the relationship", () => {
    const r = keyCompatibilityScore(k("C"), k("Am"));
    expect(r.score).toBe(0.9);
    expect(r.reason.toLowerCase()).toContain("relative minor");
  });

  test("relative major scores 0.9", () => {
    expect(keyCompatibilityScore(k("Am"), k("C")).score).toBe(0.9);
  });

  test("parallel minor scores 0.8 (same tonic, opposite mode)", () => {
    const r = keyCompatibilityScore(k("C"), k("Cm"));
    expect(r.score).toBe(0.8);
    expect(r.reason.toLowerCase()).toContain("parallel minor");
  });

  test("a fifth neighbour scores 0.75", () => {
    expect(keyCompatibilityScore(k("C"), k("G")).score).toBe(0.75); // dominant
    expect(keyCompatibilityScore(k("C"), k("F")).score).toBe(0.75); // subdominant
  });

  test("a whole tone away (two steps) scores below the fifth neighbour", () => {
    const fifth = keyCompatibilityScore(k("C"), k("G")).score;
    const tone = keyCompatibilityScore(k("C"), k("D")).score;
    expect(tone).toBeLessThan(fifth);
    expect(tone).toBeGreaterThan(0.1);
  });

  test("the tritone is the harshest move and is flagged as distant", () => {
    const r = keyCompatibilityScore(k("C"), k("F#"));
    expect(r.score).toBeLessThan(keyCompatibilityScore(k("C"), k("D")).score);
    expect(r.score).toBeGreaterThanOrEqual(0.1);
    expect(r.reason.toLowerCase()).toContain("distant");
  });

  test("score decreases monotonically as circle distance grows", () => {
    // C → G(1) → D(2) → A(3) → E(4) → B(5) ... strictly non-increasing.
    const targets = ["G", "D", "A", "E", "B"];
    const scores = targets.map((t) => keyCompatibilityScore(k("C"), k(t)).score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]!).toBeLessThanOrEqual(scores[i - 1]!);
    }
  });

  test("every result is a valid 0..1 probability with a reason", () => {
    const tonics = ["C", "G", "D", "A", "E", "B", "F#", "Db", "Ab", "Eb", "Bb", "F"];
    for (const from of tonics) {
      for (const to of tonics) {
        for (const mode of ["", "m"]) {
          const r = keyCompatibilityScore(k(from), k(to + mode));
          expect(r.score).toBeGreaterThanOrEqual(0);
          expect(r.score).toBeLessThanOrEqual(1);
          expect(r.reason.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
