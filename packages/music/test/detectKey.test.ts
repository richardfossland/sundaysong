import { describe, expect, test } from "bun:test";
import { detectKey } from "../src/detectKey";

describe("detectKey", () => {
  test("classic I-IV-V-I in C", () => {
    const d = detectKey(["C", "F", "G", "C"])!;
    expect(d.key).toBe("C");
    expect(d.confidence).toBeGreaterThan(0.5);
  });

  test("G major worship progression", () => {
    const d = detectKey(["G", "Cadd9", "D", "Em7", "G"])!;
    expect(d.key).toBe("G");
  });

  test("minor progression resolving to Am", () => {
    const d = detectKey(["Am", "Dm", "Em", "Am"])!;
    expect(d.key).toBe("Am");
  });

  test("ending chord pulls the tonic", () => {
    // vi-IV-I-V that lands home on D
    const d = detectKey(["Bm", "G", "D", "A", "D"])!;
    expect(d.key).toBe("D");
  });

  test("no parseable chords -> null", () => {
    expect(detectKey(["x2", "N.C."])).toBeNull();
  });
});
