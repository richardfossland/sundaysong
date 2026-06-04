import { describe, expect, test } from "bun:test";
import { parseChord, chordToString, transposeChord, transposeChordSymbol } from "../src/chord";

describe("parseChord", () => {
  test("plain major", () => {
    expect(parseChord("C")).toEqual({ root: 0, quality: "", bass: null });
  });

  test("extensions are preserved verbatim", () => {
    expect(parseChord("Cmaj7")).toEqual({ root: 0, quality: "maj7", bass: null });
    expect(parseChord("F#m7b5")).toEqual({ root: 6, quality: "m7b5", bass: null });
    expect(parseChord("Gsus4")).toEqual({ root: 7, quality: "sus4", bass: null });
    expect(parseChord("Aadd9")).toEqual({ root: 9, quality: "add9", bass: null });
    expect(parseChord("Bbdim")).toEqual({ root: 10, quality: "dim", bass: null });
  });

  test("slash chords", () => {
    expect(parseChord("C/E")).toEqual({ root: 0, quality: "", bass: 4 });
    expect(parseChord("F#m7b5/C")).toEqual({ root: 6, quality: "m7b5", bass: 0 });
  });

  test("german dialect roots", () => {
    expect(parseChord("H", "german")).toEqual({ root: 11, quality: "", bass: null });
    expect(parseChord("Hm", "german")).toEqual({ root: 11, quality: "m", bass: null });
    expect(parseChord("B", "german")).toEqual({ root: 10, quality: "", bass: null });
  });

  test("non-chords return null", () => {
    expect(parseChord("")).toBeNull();
    expect(parseChord("x2")).toBeNull();
    expect(parseChord("N.C.")).toBeNull();
    expect(parseChord("C/x")).toBeNull(); // slash bass not a note
  });
});

describe("chordToString roundtrip", () => {
  test("re-spells per preference", () => {
    const c = parseChord("C#m7")!;
    expect(chordToString(c, { preferFlats: false })).toBe("C#m7");
    expect(chordToString(c, { preferFlats: true })).toBe("Dbm7");
  });

  test("slash bass re-spelled too", () => {
    const c = parseChord("D/F#")!;
    expect(chordToString(c, { preferFlats: false })).toBe("D/F#");
  });
});

describe("transposeChord", () => {
  test("moves root and bass, keeps quality", () => {
    const c = parseChord("Am7/G")!;
    const up2 = transposeChord(c, 2);
    expect(up2).toEqual({ root: 11, quality: "m7", bass: 9 });
  });

  test("wraps around the octave", () => {
    expect(transposeChord(parseChord("B")!, 1).root).toBe(0);
    expect(transposeChord(parseChord("C")!, -1).root).toBe(11);
  });
});

describe("transposeChordSymbol", () => {
  test("up a tone, sharp key", () => {
    expect(transposeChordSymbol("Am", 2, { preferFlats: false })).toBe("Bm");
    expect(transposeChordSymbol("C", 2, { preferFlats: false })).toBe("D");
  });

  test("leaves non-chords alone", () => {
    expect(transposeChordSymbol("x2", 2, {})).toBe("x2");
  });
});

describe("German is/es accidentals are dialect-gated", () => {
  test("a German-style slash bass is not silently mis-rooted in the international dialect", () => {
    // "Ees" (= Eb in German verbose notation) is meaningless internationally, so
    // a slash bass with a non-note must make the whole token a non-chord, not a
    // chord with bass=3 (Eb).
    expect(parseChord("C/Ees", "international")).toBeNull();
    // German dialect still resolves it correctly (Eb = pc 3).
    expect(parseChord("C/Ees", "german")).toEqual({ root: 0, quality: "", bass: 3 });
  });
});
