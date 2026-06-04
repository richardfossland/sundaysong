/**
 * Tests for the /recommendations page logic — client-side form validation and
 * the display formatting helpers — run OFFLINE under `bun test` with no DOM,
 * no API and no network, the same offline-first discipline the API routes use.
 *
 * We exercise the pure module that both the form (`RecommendationBuilder`) and
 * the renderer (`SetDisplay`) consume, against a fixture `RecommendOutput`.
 */

import { describe, expect, test } from "bun:test";

import type { RecommendOutput, Song } from "@sundaysong/sdk";
import {
  arcSummary,
  EMPTY_FORM,
  formatDuration,
  keyFlow,
  validateForm,
  type RecommendFormState,
} from "@/lib/recommendations";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const song = (over: Partial<Song> & { id: string }): Song => ({
  canonical_title: over.id,
  original_language: "en",
  year_first_published: null,
  copyright_status: "public_domain",
  ccli_song_id: null,
  tono_work_id: null,
  tono_registered: false,
  hymnary_id: null,
  popularity_score: 0,
  nordic_metadata: {},
  themes: [],
  bible_refs: [],
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
  ...over,
});

const output: RecommendOutput = {
  picks: [
    { song: song({ id: "amazing-grace", canonical_title: "Amazing Grace", original_language: "en", year_first_published: 1779 }), reason: "Public-domain anchor on grace.", suggested_key: "G" },
    { song: song({ id: "great-is-thy", canonical_title: "Great Is Thy Faithfulness" }), reason: "Flows up a fourth from G.", suggested_key: "C" },
    { song: song({ id: "no-key", canonical_title: "Untitled" }), reason: "Thematic match, key TBD." },
  ],
  total_minutes_estimate: 14,
  summary: "A reflective set anchored on grace.",
  reranked: false,
};

const form = (over: Partial<RecommendFormState> = {}): RecommendFormState => ({ ...EMPTY_FORM, ...over });

// ── Form validation ─────────────────────────────────────────────────────────

describe("validateForm", () => {
  test("rejects an empty form — needs an anchor", () => {
    const r = validateForm(form());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("theme");
  });

  test("accepts a theme-only form and drops empty optionals", () => {
    const r = validateForm(form({ theme: "  grace  " }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input).toEqual({ theme: "grace" });
      expect(r.input.scripture).toBeUndefined();
      expect(r.input.arc).toBeUndefined();
    }
  });

  test("accepts an after-song-only form", () => {
    const r = validateForm(form({ afterSongId: "amazing-grace" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.after_song_id).toBe("amazing-grace");
  });

  test("carries scripture, description and arc through", () => {
    const r = validateForm(form({ scripture: "Psalm 23", description: "communion", arc: "reflective" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.scripture).toBe("Psalm 23");
      expect(r.input.description).toBe("communion");
      expect(r.input.arc).toBe("reflective");
    }
  });

  test("parses a valid duration into a number", () => {
    const r = validateForm(form({ theme: "grace", durationMin: "20" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.duration_min).toBe(20);
  });

  test("rejects a non-positive or non-numeric duration", () => {
    for (const bad of ["0", "-5", "abc"]) {
      const r = validateForm(form({ theme: "grace", durationMin: bad }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain("Duration");
    }
  });
});

// ── Display helpers ─────────────────────────────────────────────────────────

describe("formatDuration", () => {
  test("renders minutes under an hour", () => {
    expect(formatDuration(23)).toBe("23 min");
    expect(formatDuration(0)).toBe("0 min");
  });

  test("renders hours and minutes", () => {
    expect(formatDuration(60)).toBe("1 h");
    expect(formatDuration(65)).toBe("1 h 5 min");
    expect(formatDuration(125)).toBe("2 h 5 min");
  });

  test("clamps and rounds", () => {
    expect(formatDuration(-10)).toBe("0 min");
    expect(formatDuration(22.6)).toBe("23 min");
  });
});

describe("keyFlow", () => {
  test("collects suggested keys in order, skipping picks without one", () => {
    expect(keyFlow(output)).toEqual(["G", "C"]);
  });

  test("is empty when no pick has a key", () => {
    expect(keyFlow({ ...output, picks: [{ ...output.picks[2]! }] })).toEqual([]);
  });
});

describe("arcSummary", () => {
  test("includes the arc label, song count and duration", () => {
    expect(arcSummary(output, "reflective")).toBe("Reflective · 3 songs · 14 min");
  });

  test("omits the arc when none was chosen, and singularizes one song", () => {
    const single: RecommendOutput = { ...output, picks: [output.picks[0]!], total_minutes_estimate: 5 };
    expect(arcSummary(single, "")).toBe("1 song · 5 min");
  });
});
