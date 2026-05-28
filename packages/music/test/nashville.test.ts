import { describe, expect, test } from "bun:test";
import { toNashville, fromNashville } from "../src/nashville";

describe("toNashville", () => {
  test("diatonic chords in C", () => {
    expect(toNashville("C", "C")).toBe("1");
    expect(toNashville("Dm", "C")).toBe("2m");
    expect(toNashville("Em", "C")).toBe("3m");
    expect(toNashville("F", "C")).toBe("4");
    expect(toNashville("G", "C")).toBe("5");
    expect(toNashville("Am", "C")).toBe("6m");
  });

  test("borrowed chords get accidentals", () => {
    expect(toNashville("Bb", "C")).toBe("b7");
    expect(toNashville("Eb", "C")).toBe("b3");
  });

  test("carries quality + slash", () => {
    expect(toNashville("G7", "C")).toBe("57");
    expect(toNashville("Cmaj7", "C")).toBe("1maj7");
    expect(toNashville("G/B", "C")).toBe("5/7");
  });

  test("works in other keys", () => {
    expect(toNashville("G", "G")).toBe("1");
    expect(toNashville("D", "G")).toBe("5");
    expect(toNashville("Em", "G")).toBe("6m");
  });
});

describe("fromNashville", () => {
  test("diatonic chords in C", () => {
    expect(fromNashville("1", "C")).toBe("C");
    expect(fromNashville("4", "C")).toBe("F");
    expect(fromNashville("5", "C")).toBe("G");
    expect(fromNashville("6m", "C")).toBe("Am");
  });

  test("flat degree spells flat regardless of key preference", () => {
    expect(fromNashville("b7", "C")).toBe("Bb");
    expect(fromNashville("b3", "C")).toBe("Eb");
  });

  test("carries quality + slash", () => {
    expect(fromNashville("57", "C")).toBe("G7");
    expect(fromNashville("5/7", "C")).toBe("G/B");
  });

  test("roundtrip across keys", () => {
    for (const key of ["C", "G", "D", "A", "E", "F", "Bb"]) {
      for (const chord of ["1", "2m", "4", "5", "6m"]) {
        expect(toNashville(fromNashville(chord, key)!, key)).toBe(chord);
      }
    }
  });
});
