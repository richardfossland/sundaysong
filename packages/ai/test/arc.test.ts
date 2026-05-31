import { describe, expect, test } from "bun:test";
import { arcCurve, applyArc, type ArcShape } from "../src/arc";
import type { RankResult, RankedPick } from "../src/index";

const pick = (id: string, score = 0.5, reason = "heuristic"): RankedPick => ({
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

/** Energy of each pick after sequencing, in running order, via its reason tag. */
const energyOrder = (picks: RankedPick[]): ("low" | "mid" | "high")[] =>
  picks.map((p) =>
    p.reason.includes("high-energy") ? "high" : p.reason.includes("low-energy") ? "low" : "mid",
  );

describe("arcCurve", () => {
  test("empty and singleton sets", () => {
    expect(arcCurve("rising", 0)).toEqual([]);
    expect(arcCurve("reflective", 1)).toEqual([0.5]);
  });

  test("rising ramps from 0 to 1", () => {
    const c = arcCurve("rising", 5);
    expect(c[0]).toBe(0);
    expect(c[c.length - 1]).toBe(1);
    for (let i = 1; i < c.length; i++) expect(c[i]!).toBeGreaterThan(c[i - 1]!);
  });

  test("reflective winds down monotonically", () => {
    const c = arcCurve("reflective", 5);
    for (let i = 1; i < c.length; i++) expect(c[i]!).toBeLessThan(c[i - 1]!);
    expect(c[0]).toBeGreaterThan(c[c.length - 1]!);
  });

  test("celebration starts lifted and climbs to a peak", () => {
    const c = arcCurve("celebration", 4);
    expect(c[0]).toBe(0.5);
    expect(c[c.length - 1]).toBe(1);
  });

  test("lament stays low throughout", () => {
    const c = arcCurve("lament", 5);
    expect(Math.max(...c)).toBeLessThanOrEqual(0.4);
  });

  test("peak rises to a midpoint maximum then eases back", () => {
    const c = arcCurve("peak", 5);
    const max = Math.max(...c);
    const maxAt = c.indexOf(max);
    expect(maxAt).toBeGreaterThan(0);
    expect(maxAt).toBeLessThan(c.length - 1); // peak is interior, not at an end
  });

  test("every curve value stays within 0..1", () => {
    const arcs: ArcShape[] = ["rising", "reflective", "celebration", "lament", "peak"];
    for (const a of arcs) {
      for (const v of arcCurve(a, 7)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("applyArc", () => {
  // A fast/celebratory song, a mid song, and a slow lament — distinct energies.
  const signals = {
    fast: { bpm: 138, themes: ["celebration"] },
    mid: { bpm: 100 },
    slow: { bpm: 64, themes: ["lament"], key: { pc: 9, minor: true } },
  };

  test("no-op on an empty set", () => {
    const r = applyArc(result([]), { arc: "rising", signalsByPickId: {} });
    expect(r.arcApplied).toBe(false);
    expect(r.picks).toHaveLength(0);
  });

  test("rising puts the lowest-energy song first and the highest last", () => {
    const r = applyArc(result([pick("fast"), pick("mid"), pick("slow")]), {
      arc: "rising",
      signalsByPickId: signals,
    });
    expect(r.arcApplied).toBe(true);
    expect(r.arc).toBe("rising");
    expect(r.picks[0]!.song_id).toBe("slow");
    expect(r.picks[r.picks.length - 1]!.song_id).toBe("fast");
  });

  test("reflective is the reverse — highest energy opens, stillness closes", () => {
    const r = applyArc(result([pick("slow"), pick("mid"), pick("fast")]), {
      arc: "reflective",
      signalsByPickId: signals,
    });
    expect(r.picks[0]!.song_id).toBe("fast");
    expect(r.picks[r.picks.length - 1]!.song_id).toBe("slow");
  });

  test("peak places the highest-energy song in the interior, not at an end", () => {
    const r = applyArc(result([pick("a"), pick("b"), pick("c")]), {
      arc: "peak",
      signalsByPickId: { a: signals.slow, b: signals.fast, c: signals.mid },
    });
    const ids = r.picks.map((p) => p.song_id);
    expect(ids[0]).not.toBe("b"); // the fast song is not the opener
    expect(ids.indexOf("b")).toBeGreaterThan(0);
  });

  test("annotates each pick with its energy placement and the summary with the arc", () => {
    const r = applyArc(result([pick("fast"), pick("slow")]), {
      arc: "rising",
      signalsByPickId: signals,
    });
    expect(r.summary).toContain("rising arc");
    expect(r.picks.some((p) => p.reason.includes("high-energy"))).toBe(true);
    expect(r.picks.some((p) => p.reason.includes("low-energy"))).toBe(true);
    // The original heuristic reason is preserved.
    expect(r.picks.every((p) => p.reason.startsWith("heuristic"))).toBe(true);
  });

  test("picks with no energy signal fall back to neutral and aren't dropped", () => {
    const r = applyArc(result([pick("x"), pick("y")]), {
      arc: "rising",
      signalsByPickId: {}, // nothing known for either
    });
    expect(r.picks).toHaveLength(2);
    expect(new Set(r.picks.map((p) => p.song_id))).toEqual(new Set(["x", "y"]));
  });

  test("the realised energy order tracks the requested arc direction", () => {
    const r = applyArc(result([pick("fast"), pick("mid"), pick("slow")]), {
      arc: "rising",
      signalsByPickId: signals,
    });
    // Energy should be non-decreasing across a rising set.
    const rank = { low: 0, mid: 1, high: 2 } as const;
    const seq = energyOrder(r.picks).map((w) => rank[w]);
    for (let i = 1; i < seq.length; i++) expect(seq[i]!).toBeGreaterThanOrEqual(seq[i - 1]!);
  });

  test("never adds or loses picks, whatever the arc", () => {
    const picks = [pick("1"), pick("2"), pick("3"), pick("4")];
    const arcs: ArcShape[] = ["rising", "reflective", "celebration", "lament", "peak"];
    for (const arc of arcs) {
      const r = applyArc(result(picks), { arc, signalsByPickId: signals });
      expect(new Set(r.picks.map((p) => p.song_id))).toEqual(new Set(["1", "2", "3", "4"]));
    }
  });
});
