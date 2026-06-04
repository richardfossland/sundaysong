/**
 * Tests for the /recommendations/after page logic — client-side validation and
 * the display helpers — run OFFLINE under `bun test` with no DOM, API or
 * network, the same offline-first discipline the rest of the suite uses.
 */

import { describe, expect, test } from "bun:test";

import type { RecommendAfterOutput } from "@sundaysong/sdk";
import {
  afterKeyFlow,
  afterSummary,
  EMPTY_AFTER_FORM,
  validateAfter,
  type AfterFormState,
} from "@/lib/recommendAfter";

const form = (over: Partial<AfterFormState> = {}): AfterFormState => ({ ...EMPTY_AFTER_FORM, ...over });

const out = (over: Partial<RecommendAfterOutput> = {}): RecommendAfterOutput => ({
  picks: [
    { song_id: "great-is-thy", title: "Great Is Thy Faithfulness", score: 0.9, reason: "Up a fourth from G.", suggested_key: "C" },
    { song_id: "no-key", title: "Untitled", score: 0.4, reason: "BPM match.", suggested_key: null },
  ],
  from_key: "G",
  key_flow: true,
  ...over,
});

describe("validateAfter", () => {
  test("rejects an empty song id", () => {
    const r = validateAfter(form());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("song");
  });

  test("accepts a song id and trims it", () => {
    const r = validateAfter(form({ songId: "  amazing-grace  " }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input).toEqual({ songId: "amazing-grace" });
  });

  test("parses a valid limit into a number", () => {
    const r = validateAfter(form({ songId: "s1", limit: "10" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.limit).toBe(10);
  });

  test("rejects out-of-range or non-integer limits", () => {
    for (const bad of ["0", "21", "-1", "abc", "2.5"]) {
      const r = validateAfter(form({ songId: "s1", limit: bad }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain("Limit");
    }
  });
});

describe("afterKeyFlow", () => {
  test("starts from the from-key, then each pick's key, skipping nulls", () => {
    expect(afterKeyFlow(out())).toEqual(["G", "C"]);
  });

  test("omits the from-key when unknown", () => {
    expect(afterKeyFlow(out({ from_key: null }))).toEqual(["C"]);
  });
});

describe("afterSummary", () => {
  test("reports the from-key, count and key-flow mode", () => {
    expect(afterSummary(out())).toBe("From G · 2 songs · key-flow");
  });

  test("falls back to BPM-only / unknown key and singularizes one song", () => {
    const single = out({ picks: [out().picks[0]!], from_key: null, key_flow: false });
    expect(afterSummary(single)).toBe("Key unknown · 1 song · BPM-only");
  });
});
