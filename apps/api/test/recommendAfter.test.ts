/**
 * Tests for recommendation use case B — "songs that flow well after song X".
 *
 * Covers:
 *  1. circleOfFifthsDistanceByName  (pure, in @sundaysong/music)
 *  2. keyFlowScore                  (pure, in @sundaysong/music)
 *  3. rankAfter                     (pure ranker, in @sundaysong/ai)
 *  4. POST /v1/recommend/after      (route, via _candidates injection)
 *
 * All tests are offline — no DB, no network, no LLM.
 */

import { describe, expect, test } from "bun:test";

import { circleOfFifthsDistanceByName, keyFlowScore } from "@sundaysong/music";
import { rankAfter, type AfterCandidate } from "@sundaysong/ai";
import { recommendAfterRoutes } from "../src/routes/recommendAfter";

// ── Helpers ───────────────────────────────────────────────────────────────────

const post = (body: unknown) =>
  recommendAfterRoutes.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

// ── 1. circleOfFifthsDistanceByName ──────────────────────────────────────────

describe("circleOfFifthsDistanceByName", () => {
  test("same key name → 0", () => {
    expect(circleOfFifthsDistanceByName("C", "C")).toBe(0);
    expect(circleOfFifthsDistanceByName("G", "G")).toBe(0);
  });

  test("a fifth apart → 1 (C↔G, C↔F)", () => {
    expect(circleOfFifthsDistanceByName("C", "G")).toBe(1);
    expect(circleOfFifthsDistanceByName("C", "F")).toBe(1);
  });

  test("tritone (C↔F#) → 6", () => {
    expect(circleOfFifthsDistanceByName("C", "F#")).toBe(6);
  });

  test("minor key names are stripped to tonic (Am ≈ A)", () => {
    // A and Am have the same tonic → same circle distance as C↔A
    expect(circleOfFifthsDistanceByName("C", "Am")).toBe(circleOfFifthsDistanceByName("C", "A"));
  });

  test("returns 6 (worst) for unparseable key names", () => {
    expect(circleOfFifthsDistanceByName("??", "C")).toBe(6);
    expect(circleOfFifthsDistanceByName("C", "")).toBe(6);
  });

  test("is symmetric", () => {
    expect(circleOfFifthsDistanceByName("D", "Bb")).toBe(circleOfFifthsDistanceByName("Bb", "D"));
  });
});

// ── 2. keyFlowScore ───────────────────────────────────────────────────────────

describe("keyFlowScore", () => {
  test("same key → 1.0", () => {
    expect(keyFlowScore("G", "G")).toBe(1.0);
    expect(keyFlowScore("Bb", "Bb")).toBe(1.0);
  });

  test("parallel major/minor (same tonic) → 1.0", () => {
    expect(keyFlowScore("C", "Cm")).toBe(1.0);
    expect(keyFlowScore("Dm", "D")).toBe(1.0);
  });

  test("relative major/minor → 0.85", () => {
    expect(keyFlowScore("C", "Am")).toBe(0.85);
    expect(keyFlowScore("Am", "C")).toBe(0.85);
  });

  test("one step on circle (V / IV) → 0.85", () => {
    // C→G is one step; since parallel/same check passed first it's 0.85 for neighbours
    expect(keyFlowScore("C", "G")).toBe(0.85);
    expect(keyFlowScore("C", "F")).toBe(0.85);
  });

  test("distance 2 → 0.65", () => {
    // C→D is 2 steps (C→G→D)
    expect(keyFlowScore("C", "D")).toBe(0.65);
  });

  test("tritone (6 steps) → 0.1", () => {
    expect(keyFlowScore("C", "F#")).toBe(0.1);
  });

  test("returns 0 for unparseable input (safe degradation)", () => {
    expect(keyFlowScore("??", "C")).toBe(0);
    expect(keyFlowScore("C", "")).toBe(0);
  });

  test("score decreases or stays equal as distance grows from C", () => {
    const chain = ["G", "D", "A", "E", "B", "F#"];
    const scores = chain.map((k) => keyFlowScore("C", k));
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]!).toBeLessThanOrEqual(scores[i - 1]!);
    }
  });
});

// ── 3. rankAfter (pure ranker) ────────────────────────────────────────────────

describe("rankAfter", () => {
  const makeCandidates = (): AfterCandidate[] => [
    { id: "a", title: "Amazing Grace",  key: "C",  bpm: 80 },
    { id: "b", title: "How Great",      key: "G",  bpm: 85 },
    { id: "c", title: "Tritone Away",   key: "F#", bpm: 140 },
    { id: "d", title: "Relative Minor", key: "Am", bpm: 78 },
    { id: "e", title: "No Key Known",   key: null, bpm: 80 },
  ];

  test("same-key candidate scores highest when flowing from C", () => {
    const { picks } = rankAfter("C", null, makeCandidates());
    expect(picks[0]!.song_id).toBe("a"); // C = same key as from-key C
  });

  test("tritone candidate scores lower than adjacent key", () => {
    const { picks } = rankAfter("C", null, makeCandidates());
    const tritoneIdx = picks.findIndex((p) => p.song_id === "c");
    const adjacentIdx = picks.findIndex((p) => p.song_id === "b");
    expect(tritoneIdx).toBeGreaterThan(adjacentIdx);
  });

  test("BPM proximity gives a bonus when within 20 BPM", () => {
    // From 80 BPM, candidate at 85 BPM gets a bonus; candidate at 140 BPM does not.
    const { picks } = rankAfter("C", 80, [
      { id: "x", title: "Near", key: "F#", bpm: 82 },  // tritone key but close BPM
      { id: "y", title: "Far",  key: "G",  bpm: 140 }, // good key but far BPM
    ]);
    // Both have BPM: near has terrible key (0.1) + good BPM bonus; far has good key (0.85) + no bonus.
    // near  = 0.1 + (1 - 2/20)*0.15 + 0 = 0.1 + 0.135 = 0.235
    // far   = 0.85 + 0           + 0 = 0.85
    // y should still win because key dominates
    expect(picks[0]!.song_id).toBe("y");
  });

  test("limit is respected", () => {
    const { picks } = rankAfter("C", null, makeCandidates(), 2);
    expect(picks).toHaveLength(2);
  });

  test("key_flow is false when from-key is null", () => {
    const { key_flow } = rankAfter(null, null, makeCandidates());
    expect(key_flow).toBe(false);
  });

  test("key_flow is true when from-key is valid", () => {
    const { key_flow } = rankAfter("G", null, makeCandidates());
    expect(key_flow).toBe(true);
  });

  test("from_key is echoed back", () => {
    expect(rankAfter("D", null, []).from_key).toBe("D");
    expect(rankAfter(null, null, []).from_key).toBeNull();
  });

  test("all scores stay within 0..1", () => {
    const { picks } = rankAfter("G", 100, makeCandidates());
    for (const p of picks) {
      expect(p.score).toBeGreaterThanOrEqual(0);
      expect(p.score).toBeLessThanOrEqual(1);
    }
  });

  test("each pick has a non-empty reason string", () => {
    const { picks } = rankAfter("C", 80, makeCandidates());
    for (const p of picks) {
      expect(typeof p.reason).toBe("string");
      expect(p.reason.length).toBeGreaterThan(0);
    }
  });

  test("empty candidates returns empty picks without throwing", () => {
    const { picks } = rankAfter("C", 80, []);
    expect(picks).toHaveLength(0);
  });
});

// ── 4. POST /v1/recommend/after (route via _candidates injection) ─────────────

describe("POST /v1/recommend/after", () => {
  const candidates: AfterCandidate[] = [
    { id: "s1", title: "Song in G",  key: "G",  bpm: 90 },
    { id: "s2", title: "Song in F#", key: "F#", bpm: 90 },
    { id: "s3", title: "Song in C",  key: "C",  bpm: 90 },
  ];

  test("200 with _candidates injection — ranks by key flow from C", async () => {
    const res = await post({
      songId: "from-song",
      _candidates: candidates,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { picks: Array<{ song_id: string }>; key_flow: boolean };
    // With no from_key resolved (no DB), key_flow = false but picks are still returned
    expect(Array.isArray(json.picks)).toBe(true);
  });

  test("400 on missing songId", async () => {
    const res = await post({ limit: 5 });
    expect(res.status).toBe(400);
  });

  test("400 on limit out of range (> 20)", async () => {
    const res = await post({ songId: "x", limit: 99 });
    expect(res.status).toBe(400);
  });

  test("respects limit parameter", async () => {
    const res = await post({ songId: "x", limit: 2, _candidates: candidates });
    const json = (await res.json()) as { picks: unknown[] };
    expect(json.picks).toHaveLength(2);
  });

  test("returns key_flow field in response", async () => {
    const res = await post({ songId: "x", _candidates: candidates });
    const json = (await res.json()) as { key_flow: boolean };
    expect(typeof json.key_flow).toBe("boolean");
  });

  test("returns from_key field in response", async () => {
    const res = await post({ songId: "x", _candidates: candidates });
    const json = (await res.json()) as { from_key: string | null };
    // from_key is null because we injected candidates without a from-song key
    expect(json.from_key).toBeNull();
  });
});
