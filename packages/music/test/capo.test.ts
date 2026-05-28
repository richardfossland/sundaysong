import { describe, expect, test } from "bun:test";
import { suggestCapo } from "../src/capo";

describe("suggestCapo", () => {
  test("Eb suggests capo 1 playing D shapes (the classic)", () => {
    const s = suggestCapo("Eb");
    expect(s[0]).toEqual({ capo: 1, playAs: "D" });
    // capo 3 -> C shapes should also be offered
    expect(s).toContainEqual({ capo: 3, playAs: "C" });
  });

  test("F suggests capo 1 -> E and capo 3 -> D", () => {
    const s = suggestCapo("F");
    expect(s).toContainEqual({ capo: 1, playAs: "E" });
    expect(s).toContainEqual({ capo: 3, playAs: "D" });
  });

  test("every position plays an open-friendly shape", () => {
    const open = new Set(["C", "G", "D", "A", "E"]);
    for (const { playAs } of suggestCapo("Ab")) {
      expect(open.has(playAs)).toBe(true);
    }
  });

  test("minor key uses minor open shapes", () => {
    const s = suggestCapo("Cm");
    const openMinor = new Set(["Am", "Em", "Dm"]);
    expect(s.length).toBeGreaterThan(0);
    for (const { playAs } of s) expect(openMinor.has(playAs)).toBe(true);
  });

  test("invalid key -> no suggestions", () => {
    expect(suggestCapo("Q")).toEqual([]);
  });
});
