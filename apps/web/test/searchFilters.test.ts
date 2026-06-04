/**
 * Tests for the /songs search-filter param logic — pure form <-> SDK <-> URL
 * projection. Runs OFFLINE under `bun test` with no DOM, API or network.
 */

import { describe, expect, test } from "bun:test";

import {
  activeFilterCount,
  BPM_MAX,
  BPM_MIN,
  buildSearchQuery,
  EMPTY_FILTERS,
  filtersFromQuery,
  filtersToParams,
  isValidKey,
  KEY_OPTIONS,
  type SearchFilterState,
} from "@/lib/searchFilters";

const filled: SearchFilterState = {
  language: "no",
  theme: "grace",
  bpmMin: "70",
  bpmMax: "90",
  key: "G",
};

describe("filtersToParams", () => {
  test("projects a full form onto SDK filter params", () => {
    expect(filtersToParams(filled)).toEqual({
      language: "no",
      themes: ["grace"],
      bpm_min: 70,
      bpm_max: 90,
      key: "G",
    });
  });

  test("empty form yields no params (never sends empty strings)", () => {
    expect(filtersToParams(EMPTY_FILTERS)).toEqual({});
  });

  test("trims whitespace on string fields", () => {
    expect(filtersToParams({ ...EMPTY_FILTERS, language: "  en  ", theme: " hope " })).toEqual({
      language: "en",
      themes: ["hope"],
    });
  });

  test("drops out-of-range bpm rather than sending it", () => {
    expect(filtersToParams({ ...EMPTY_FILTERS, bpmMin: String(BPM_MIN - 1) })).toEqual({});
    expect(filtersToParams({ ...EMPTY_FILTERS, bpmMax: String(BPM_MAX + 1) })).toEqual({});
  });

  test("keeps bpm at the inclusive bounds", () => {
    expect(filtersToParams({ ...EMPTY_FILTERS, bpmMin: String(BPM_MIN), bpmMax: String(BPM_MAX) })).toEqual({
      bpm_min: BPM_MIN,
      bpm_max: BPM_MAX,
    });
  });

  test("truncates a fractional bpm to an integer", () => {
    expect(filtersToParams({ ...EMPTY_FILTERS, bpmMin: "72.9" })).toEqual({ bpm_min: 72 });
  });

  test("ignores a non-numeric bpm", () => {
    expect(filtersToParams({ ...EMPTY_FILTERS, bpmMin: "fast" })).toEqual({});
  });

  test("normalises a flipped bpm range by swapping", () => {
    expect(filtersToParams({ ...EMPTY_FILTERS, bpmMin: "120", bpmMax: "80" })).toEqual({
      bpm_min: 80,
      bpm_max: 120,
    });
  });

  test("drops an unparseable key", () => {
    expect(filtersToParams({ ...EMPTY_FILTERS, key: "Zz9" })).toEqual({});
  });

  test("accepts a minor key", () => {
    expect(filtersToParams({ ...EMPTY_FILTERS, key: "Am" })).toEqual({ key: "Am" });
  });
});

describe("KEY_OPTIONS / isValidKey", () => {
  test("lists 12 majors + 12 minors with no duplicate spellings", () => {
    expect(KEY_OPTIONS.length).toBe(24);
    expect(new Set(KEY_OPTIONS).size).toBe(KEY_OPTIONS.length);
  });

  test("contains the common worship keys", () => {
    for (const k of ["C", "G", "D", "A", "E", "Bb", "Eb", "Am", "Em", "Dm"]) {
      expect(KEY_OPTIONS).toContain(k);
    }
  });

  test("every listed option is itself a valid key", () => {
    for (const k of KEY_OPTIONS) expect(isValidKey(k)).toBe(true);
  });

  test("rejects junk", () => {
    expect(isValidKey("")).toBe(false);
    expect(isValidKey("H#x")).toBe(false);
  });
});

describe("filtersFromQuery", () => {
  test("reads filter state from URL params, mapping lang", () => {
    expect(
      filtersFromQuery({ lang: "no", theme: "grace", bpm_min: "70", bpm_max: "90", key: "G" }),
    ).toEqual(filled);
  });

  test("missing params become empty strings", () => {
    expect(filtersFromQuery({})).toEqual(EMPTY_FILTERS);
  });

  test("round-trips: query -> state -> params equals direct projection", () => {
    const state = filtersFromQuery({ lang: "no", theme: "grace", bpm_min: "70", bpm_max: "90", key: "G" });
    expect(filtersToParams(state)).toEqual(filtersToParams(filled));
  });
});

describe("buildSearchQuery", () => {
  test("writes q, lang, theme, bpm range and key", () => {
    const qs = buildSearchQuery({ q: "grace", filters: filled });
    const p = new URLSearchParams(qs);
    expect(p.get("q")).toBe("grace");
    expect(p.get("lang")).toBe("no");
    expect(p.get("theme")).toBe("grace");
    expect(p.get("bpm_min")).toBe("70");
    expect(p.get("bpm_max")).toBe("90");
    expect(p.get("key")).toBe("G");
  });

  test("carries mode=meaning only when set", () => {
    expect(new URLSearchParams(buildSearchQuery({ q: "x", mode: "meaning", filters: EMPTY_FILTERS })).get("mode")).toBe(
      "meaning",
    );
    expect(new URLSearchParams(buildSearchQuery({ q: "x", mode: "text", filters: EMPTY_FILTERS })).has("mode")).toBe(
      false,
    );
  });

  test("omits empty/invalid filters from the URL", () => {
    const qs = buildSearchQuery({ q: "grace", filters: { ...EMPTY_FILTERS, key: "nope", bpmMin: "5" } });
    const p = new URLSearchParams(qs);
    expect(p.has("key")).toBe(false);
    expect(p.has("bpm_min")).toBe(false);
    expect([...p.keys()]).toEqual(["q"]);
  });

  test("a parsed URL round-trips back into the same filter state", () => {
    const qs = buildSearchQuery({ q: "grace", filters: filled });
    const p = new URLSearchParams(qs);
    const back = filtersFromQuery({
      lang: p.get("lang") ?? undefined,
      theme: p.get("theme") ?? undefined,
      bpm_min: p.get("bpm_min") ?? undefined,
      bpm_max: p.get("bpm_max") ?? undefined,
      key: p.get("key") ?? undefined,
    });
    expect(back).toEqual(filled);
  });
});

describe("activeFilterCount", () => {
  test("counts a bpm range once", () => {
    expect(activeFilterCount({ ...EMPTY_FILTERS, bpmMin: "70", bpmMax: "90" })).toBe(1);
  });

  test("counts each active dimension", () => {
    expect(activeFilterCount(filled)).toBe(4); // language + theme + range + key
  });

  test("zero for an empty form", () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
  });
});
