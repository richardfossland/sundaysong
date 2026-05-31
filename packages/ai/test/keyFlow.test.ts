import { describe, expect, test } from "bun:test";
import { applyKeyFlow } from "../src/keyFlow";
import type { RankResult, RankedPick } from "../src/index";

const pick = (id: string, score: number, reason = "heuristic"): RankedPick => ({
  song_id: id,
  title: `S${id}`,
  score,
  reason,
});

const result = (picks: RankedPick[]): RankResult => ({
  picks,
  total_minutes_estimate: picks.length * 4,
  summary: "a set",
});

describe("applyKeyFlow", () => {
  test("no-op (keyFlow:false) when the from-key is unparseable", () => {
    const r = applyKeyFlow(result([pick("1", 0.5)]), { fromKey: "???", keysByPickId: { "1": "C" } });
    expect(r.keyFlow).toBe(false);
    expect(r.picks).toEqual([pick("1", 0.5)]);
  });

  test("no-op when there are no picks", () => {
    const r = applyKeyFlow(result([]), { fromKey: "G", keysByPickId: {} });
    expect(r.keyFlow).toBe(false);
    expect(r.picks).toHaveLength(0);
  });

  test("a same-key song is promoted over a slightly higher-scored distant-key song", () => {
    // Coming from C. Song 1 is on-theme (0.6) but in F# (tritone); song 2 is
    // weaker (0.5) but in C (perfect flow). The flow blend should reorder them.
    const r = applyKeyFlow(result([pick("1", 0.6), pick("2", 0.5)]), {
      fromKey: "C",
      keysByPickId: { "1": "F#", "2": "C" },
    });
    expect(r.keyFlow).toBe(true);
    expect(r.picks[0]!.song_id).toBe("2");
    expect(r.picks[0]!.reason.toLowerCase()).toContain("flows well");
    expect(r.picks[0]!.reason.toLowerCase()).toContain("same key");
  });

  test("strong theme fit still beats a perfect key when the gap is large (flow is a tiebreaker)", () => {
    // Song 1 dominates on heuristic (0.95) even in a distant key; song 2 is
    // weak (0.2) in the same key. The blend keeps song 1 on top.
    const r = applyKeyFlow(result([pick("1", 0.95), pick("2", 0.2)]), {
      fromKey: "C",
      keysByPickId: { "1": "F#", "2": "C" },
    });
    expect(r.picks[0]!.song_id).toBe("1");
  });

  test("picks with no resolvable key keep their heuristic reason (no boost, no penalty)", () => {
    const r = applyKeyFlow(result([pick("1", 0.5)]), { fromKey: "G", keysByPickId: { "1": null } });
    expect(r.keyFlow).toBe(true);
    expect(r.picks[0]!.reason).toBe("heuristic");
    expect(r.picks[0]!.score).toBe(0.5); // unchanged
  });

  test("relative minor flows nearly as well as the same key", () => {
    // From C: song 1 in Am (relative minor, 0.9), song 2 in D (whole tone).
    const r = applyKeyFlow(result([pick("1", 0.5), pick("2", 0.5)]), {
      fromKey: "C",
      keysByPickId: { "1": "Am", "2": "D" },
    });
    expect(r.picks[0]!.song_id).toBe("1");
    expect(r.picks[0]!.reason.toLowerCase()).toContain("relative minor");
  });

  test("annotates the summary with the from-key", () => {
    const r = applyKeyFlow(result([pick("1", 0.5)]), { fromKey: "Bb", keysByPickId: { "1": "Bb" } });
    expect(r.summary).toContain("flow from Bb");
  });

  test("scores stay within 0..1 and order is stable for equal blends", () => {
    const r = applyKeyFlow(result([pick("a", 0.5), pick("b", 0.5)]), {
      fromKey: "C",
      keysByPickId: { a: "C", b: "C" },
    });
    expect(r.picks.map((p) => p.song_id)).toEqual(["a", "b"]); // stable
    for (const p of r.picks) {
      expect(p.score).toBeGreaterThanOrEqual(0);
      expect(p.score).toBeLessThanOrEqual(1);
    }
  });
});
