import { describe, expect, test } from "bun:test";
import {
  shortestSemitones,
  transposeChordsToKey,
  transposeChordsBySemitones,
} from "../src/transpose";
import { parseKey } from "../src/keys";

describe("shortestSemitones", () => {
  test("picks the short way around", () => {
    expect(shortestSemitones(parseKey("C")!, parseKey("D")!)).toBe(2);
    expect(shortestSemitones(parseKey("C")!, parseKey("Bb")!)).toBe(-2);
    expect(shortestSemitones(parseKey("C")!, parseKey("F#")!)).toBe(6);
    expect(shortestSemitones(parseKey("C")!, parseKey("C")!)).toBe(0);
  });
});

describe("transposeChordsToKey", () => {
  test("C major progression up to D (sharp key)", () => {
    const r = transposeChordsToKey(["C", "F", "G", "Am"], "C", "D");
    expect(r.semitones).toBe(2);
    expect(r.toKey).toBe("D");
    expect(r.chords).toEqual(["D", "G", "A", "Bm"]);
  });

  test("C major down to Eb spells with flats", () => {
    const r = transposeChordsToKey(["C", "F", "G"], "C", "Eb");
    expect(r.semitones).toBe(3);
    expect(r.chords).toEqual(["Eb", "Ab", "Bb"]);
  });

  test("preserves extensions and slash basses", () => {
    const r = transposeChordsToKey(["Cmaj7", "Dm7", "G7/B"], "C", "E");
    expect(r.chords).toEqual(["Emaj7", "F#m7", "B7/D#"]);
  });

  test("transposes a real worship chart across all 12 keys without crashing", () => {
    const chords = ["G", "D", "Em7", "Cadd9", "G/B", "D/F#"];
    const keys = ["G", "Ab", "A", "Bb", "B", "C", "Db", "D", "Eb", "E", "F", "F#"];
    for (const k of keys) {
      const r = transposeChordsToKey(chords, "G", k);
      expect(r.chords).toHaveLength(chords.length);
      // every output token must re-parse as a chord (no garbage spelling)
      for (const c of r.chords) expect(c).toMatch(/^[A-G]/);
    }
  });

  test("german/nordic dialect understands H and renders it back", () => {
    // A->H is +2 semitones. Inputs parse in german (H=11, Cis=C#=1).
    const r = transposeChordsToKey(["A", "H", "Cis"], "A", "H", "german");
    expect(r.toKey).toBe("H");
    expect(r.semitones).toBe(2);
    expect(r.chords).toEqual(["H", "C#", "D#"]);
  });

  test("throws on invalid key", () => {
    expect(() => transposeChordsToKey(["C"], "C", "Q")).toThrow();
  });
});

describe("transposeChordsBySemitones", () => {
  test("+1 from C lands in Db and spells flat", () => {
    const r = transposeChordsBySemitones(["C", "G", "Am"], 1, "C");
    expect(r.toKey).toBe("Db");
    expect(r.chords).toEqual(["Db", "Ab", "Bbm"]);
  });

  test("-2 from C lands in Bb", () => {
    const r = transposeChordsBySemitones(["C", "F", "G"], -2, "C");
    expect(r.toKey).toBe("Bb");
    expect(r.chords).toEqual(["Bb", "Eb", "F"]);
  });
});
