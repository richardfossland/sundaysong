import { describe, expect, test } from "bun:test";
import {
  transposeChordProToKey,
  transposeChordProBySemitones,
  extractChords,
  normalizeKey,
} from "../src/chordpro";

const SAMPLE = `{title: Amazing Grace}
[G]Amazing [G7]grace how [C]sweet the [G]sound
That [G]saved a [Em]wretch like [D]me`;

describe("transposeChordProToKey", () => {
  test("transposes bracketed chords, leaves lyrics + directives", () => {
    const { text, semitones } = transposeChordProToKey(SAMPLE, "G", "A");
    expect(semitones).toBe(2);
    expect(text).toContain("{title: Amazing Grace}");
    expect(text).toContain("[A]Amazing [A7]grace");
    expect(text).toContain("[D]sweet the [A]sound");
    expect(text).toContain("[F#m]wretch like [E]me");
    // lyrics untouched
    expect(text).toContain("how ");
  });

  test("flat target key spells flats", () => {
    const { text } = transposeChordProToKey("[C]test [G]ing", "C", "Eb");
    expect(text).toContain("[Eb]test [Bb]ing");
  });

  test("passes through non-chord brackets like [x2]", () => {
    const { text } = transposeChordProToKey("[C]la [x2] [G]la", "C", "D");
    expect(text).toContain("[x2]");
    expect(text).toContain("[D]la");
    expect(text).toContain("[A]la");
  });
});

describe("transposeChordProBySemitones", () => {
  test("raw semitone shift", () => {
    const out = transposeChordProBySemitones("[C][F][G]", 5, { preferFlats: false });
    expect(out).toBe("[F][A#][C]");
  });
});

describe("extractChords", () => {
  test("pulls chord tokens in order", () => {
    expect(extractChords(SAMPLE)).toEqual(["G", "G7", "C", "G", "G", "Em", "D"]);
  });
});

describe("normalizeKey", () => {
  test("canonicalizes display form (enharmonic -> conventional spelling)", () => {
    expect(normalizeKey("eb")).toBe("Eb");
    expect(normalizeKey("d#m")).toBe("Ebm"); // pc 3 minor conventionally spelled flat
    expect(normalizeKey("bb")).toBe("Bb");
    expect(normalizeKey("nonsense")).toBeNull();
  });
});
