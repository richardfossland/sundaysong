/**
 * Offline tests for the Sermon-to-Setlist page logic. Pure — no DOM, no API;
 * exercises validateSermonForm, parseRefsInput and the coverage-pill helpers.
 */

import { describe, expect, test } from "bun:test";
import {
  validateSermonForm,
  parseRefsInput,
  coverageStatusLabel,
  coveragePill,
  EMPTY_SERMON_FORM,
  type SermonFormState,
} from "../lib/recommendSermon";

const form = (over: Partial<SermonFormState> = {}): SermonFormState => ({ ...EMPTY_SERMON_FORM, ...over });

describe("parseRefsInput", () => {
  test("splits on newline/comma/semicolon, trims + dedupes", () => {
    expect(parseRefsInput("Lukas 15\nSalme 23, Salme 23; Romerne 8")).toEqual(["Lukas 15", "Salme 23", "Romerne 8"]);
  });
  test("empty → []", () => {
    expect(parseRefsInput("   ")).toEqual([]);
  });
});

describe("validateSermonForm", () => {
  test("requires a manuscript or at least one ref", () => {
    const v = validateSermonForm(form());
    expect(v.ok).toBe(false);
  });

  test("manuscript alone is valid", () => {
    const v = validateSermonForm(form({ manuscript: "En preken om nåde" }));
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.input.manuscript).toBe("En preken om nåde");
  });

  test("refs alone is valid; projected to scripture_refs", () => {
    const v = validateSermonForm(form({ scriptureRefs: "Salme 23\nLukas 15" }));
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.input.scripture_refs).toEqual(["Salme 23", "Lukas 15"]);
  });

  test("title + duration carried; bad duration rejected", () => {
    const ok = validateSermonForm(form({ manuscript: "x", title: "T", durationMin: "20" }));
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.input.title).toBe("T");
      expect(ok.input.duration_min).toBe(20);
    }
    expect(validateSermonForm(form({ manuscript: "x", durationMin: "-3" })).ok).toBe(false);
    expect(validateSermonForm(form({ manuscript: "x", durationMin: "abc" })).ok).toBe(false);
  });

  test("empty optionals are dropped (never sends '')", () => {
    const v = validateSermonForm(form({ manuscript: "x" }));
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.input.title).toBeUndefined();
      expect(v.input.scripture_refs).toBeUndefined();
      expect(v.input.duration_min).toBeUndefined();
    }
  });
});

describe("coverage pill helpers", () => {
  test("status labels map to tones", () => {
    expect(coverageStatusLabel("covered").tone).toBe("ok");
    expect(coverageStatusLabel("not_required").tone).toBe("na");
    expect(coverageStatusLabel("not_covered").tone).toBe("no");
    expect(coverageStatusLabel("foreign_reciprocal").tone).toBe("warn");
    expect(coverageStatusLabel("unknown").tone).toBe("warn");
  });

  test("coveragePill collapses to the worst tone", () => {
    expect(coveragePill({ song_id: "s", ccli_status: "covered", tono_status: "covered", gray_areas: [] }).tone).toBe("ok");
    expect(coveragePill({ song_id: "s", ccli_status: "covered", tono_status: "unknown", gray_areas: [] }).tone).toBe("warn");
    expect(coveragePill({ song_id: "s", ccli_status: "not_covered", tono_status: "covered", gray_areas: [] }).tone).toBe("no");
  });

  test("pill text names both licensors", () => {
    const pill = coveragePill({ song_id: "s", ccli_status: "covered", tono_status: "not_required", gray_areas: [] });
    expect(pill.text).toContain("CCLI");
    expect(pill.text).toContain("TONO");
  });
});
