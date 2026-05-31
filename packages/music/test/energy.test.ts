import { describe, expect, test } from "bun:test";
import { bpmEnergy, estimateEnergy } from "../src/energy";
import { parseKey, type Key } from "../src/keys";

const k = (s: string): Key => {
  const key = parseKey(s);
  if (!key) throw new Error(`bad test key: ${s}`);
  return key;
};

describe("bpmEnergy", () => {
  test("a slow ballad tempo sits near zero", () => {
    expect(bpmEnergy(60)).toBe(0);
  });

  test("a driving anthem tempo saturates near one", () => {
    expect(bpmEnergy(140)).toBe(1);
  });

  test("the midpoint of the worship range is around half", () => {
    expect(bpmEnergy(100)).toBeCloseTo(0.5, 1);
  });

  test("clamps below and above the anchored range", () => {
    expect(bpmEnergy(40)).toBe(0);
    expect(bpmEnergy(200)).toBe(1);
  });

  test("is monotonically increasing in tempo", () => {
    const tempos = [50, 70, 90, 110, 130, 150];
    const e = tempos.map(bpmEnergy);
    for (let i = 1; i < e.length; i++) expect(e[i]!).toBeGreaterThanOrEqual(e[i - 1]!);
  });
});

describe("estimateEnergy — BPM anchors the estimate", () => {
  test("fast tempo reads as high energy", () => {
    const r = estimateEnergy({ bpm: 138 });
    expect(r.value).toBeGreaterThan(0.85);
    expect(r.unknown).toBe(false);
    expect(r.reasons.join(" ")).toContain("138 BPM");
  });

  test("slow tempo reads as low energy", () => {
    expect(estimateEnergy({ bpm: 64 }).value).toBeLessThan(0.15);
  });

  test("a minor key nudges a BPM estimate down", () => {
    const major = estimateEnergy({ bpm: 100, key: k("C") }).value;
    const minor = estimateEnergy({ bpm: 100, key: k("Am") }).value;
    expect(minor).toBeLessThan(major);
  });

  test("an uplifting theme nudges a BPM estimate up and is explained", () => {
    const plain = estimateEnergy({ bpm: 100 }).value;
    const r = estimateEnergy({ bpm: 100, themes: ["celebration"] });
    expect(r.value).toBeGreaterThan(plain);
    expect(r.reasons.join(" ").toLowerCase()).toContain("uplifting theme");
  });

  test("ignores zero / NaN / negative BPM and falls back to soft signals", () => {
    const r = estimateEnergy({ bpm: 0, themes: ["lament"] });
    expect(r.reasons.join(" ")).not.toContain("BPM");
    expect(r.value).toBeLessThan(0.5);
  });
});

describe("estimateEnergy — soft signals without BPM", () => {
  test("a lament theme reads as low energy", () => {
    const r = estimateEnergy({ themes: ["lament"] });
    expect(r.value).toBeLessThan(0.5);
    expect(r.unknown).toBe(false);
  });

  test("a celebration theme reads as high energy", () => {
    expect(estimateEnergy({ themes: ["celebration"] }).value).toBeGreaterThan(0.5);
  });

  test("a minor key alone tilts reflective", () => {
    expect(estimateEnergy({ key: k("Em") }).value).toBeLessThan(0.5);
  });

  test("title keywords only apply when no theme/key signal is present", () => {
    // Theme present → title is ignored (celebratory title shouldn't override a lament theme).
    const withTheme = estimateEnergy({ themes: ["lament"], title: "Shout for Joy" });
    expect(withTheme.value).toBeLessThan(0.5);
    // No theme/key → title carries the estimate.
    const titleOnly = estimateEnergy({ title: "Shout for Joy" });
    expect(titleOnly.value).toBeGreaterThan(0.5);
    expect(titleOnly.reasons.join(" ").toLowerCase()).toContain("celebratory title");
  });

  test("a reflective title reads low", () => {
    expect(estimateEnergy({ title: "Be Still My Soul" }).value).toBeLessThan(0.5);
  });
});

describe("estimateEnergy — unknown / neutral", () => {
  test("no usable signal returns neutral 0.5 flagged unknown", () => {
    const r = estimateEnergy({});
    expect(r.value).toBe(0.5);
    expect(r.unknown).toBe(true);
    expect(r.reasons.join(" ").toLowerCase()).toContain("neutral");
  });

  test("a title with no recognised keyword is still neutral/unknown", () => {
    const r = estimateEnergy({ title: "Amazing Grace" });
    expect(r.unknown).toBe(true);
    expect(r.value).toBe(0.5);
  });

  test("every estimate is a valid 0..1 value with at least one reason", () => {
    const cases = [
      {},
      { bpm: 120 },
      { bpm: 70, key: k("Dm"), themes: ["communion"] },
      { themes: ["praise", "joy"] },
      { key: k("G"), themes: ["lament"] },
      { title: "Hallelujah" },
    ];
    for (const c of cases) {
      const r = estimateEnergy(c);
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.value).toBeLessThanOrEqual(1);
      expect(r.reasons.length).toBeGreaterThan(0);
    }
  });
});
