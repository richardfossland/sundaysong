import { describe, expect, test } from "bun:test";
import { noteToPc, pcToNote } from "../src/notes";

describe("noteToPc — international", () => {
  test("naturals", () => {
    expect(noteToPc("C")).toBe(0);
    expect(noteToPc("D")).toBe(2);
    expect(noteToPc("E")).toBe(4);
    expect(noteToPc("F")).toBe(5);
    expect(noteToPc("G")).toBe(7);
    expect(noteToPc("A")).toBe(9);
    expect(noteToPc("B")).toBe(11);
  });

  test("accidentals", () => {
    expect(noteToPc("C#")).toBe(1);
    expect(noteToPc("Db")).toBe(1);
    expect(noteToPc("Bb")).toBe(10);
    expect(noteToPc("E#")).toBe(5); // enharmonic with F
    expect(noteToPc("Cb")).toBe(11);
    expect(noteToPc("C♯")).toBe(1);
    expect(noteToPc("D♭")).toBe(1);
  });

  test("H is not a note internationally", () => {
    expect(noteToPc("H")).toBeNull();
  });

  test("rejects garbage", () => {
    expect(noteToPc("")).toBeNull();
    expect(noteToPc("X")).toBeNull();
    expect(noteToPc("Cmaj7")).toBeNull(); // a chord, not a bare note
  });

  test("rejects German verbose is/es accidentals (German-only notation)", () => {
    // In international notation "is"/"es" are not accidentals; a token like "Eis"
    // is not a bare note and must not be silently re-rooted to F (pc 5).
    expect(noteToPc("Eis")).toBeNull();
    expect(noteToPc("Ees")).toBeNull();
    expect(noteToPc("Cis")).toBeNull();
    expect(noteToPc("Des")).toBeNull();
  });
});

describe("noteToPc — german/nordic dialect", () => {
  test("H = B-natural, B = B-flat", () => {
    expect(noteToPc("H", "german")).toBe(11);
    expect(noteToPc("B", "german")).toBe(10);
  });

  test("verbose is/es accidentals", () => {
    expect(noteToPc("Cis", "german")).toBe(1);
    expect(noteToPc("Des", "german")).toBe(1);
    expect(noteToPc("Fis", "german")).toBe(6);
  });
});

describe("pcToNote", () => {
  test("sharp vs flat spelling", () => {
    expect(pcToNote(1, { preferFlats: false })).toBe("C#");
    expect(pcToNote(1, { preferFlats: true })).toBe("Db");
    expect(pcToNote(10, { preferFlats: true })).toBe("Bb");
    expect(pcToNote(10, { preferFlats: false })).toBe("A#");
  });

  test("german spelling swaps B/H", () => {
    expect(pcToNote(11, { dialect: "german" })).toBe("H");
    expect(pcToNote(10, { dialect: "german" })).toBe("B");
  });

  test("wraps negative + out of range", () => {
    expect(pcToNote(-1)).toBe("B");
    expect(pcToNote(12)).toBe("C");
  });
});
