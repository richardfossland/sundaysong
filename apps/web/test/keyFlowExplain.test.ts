/**
 * Tests for the /recommendations/flow page explainer — the pure relationship
 * classifier that labels WHY a successor key flows. Runs OFFLINE under
 * `bun test` with no DOM, API or network, building on @sundaysong/music.
 *
 * These pin the invariants the UI relies on, not just one happy path:
 *  - every recognised relation is reachable from a concrete key pair,
 *  - the classification ladder agrees with the engine's score ordering,
 *  - distance is symmetric and within 0..6,
 *  - unknown/unparseable keys degrade honestly instead of guessing.
 */

import { describe, expect, test } from "bun:test";

import {
  explainFlow,
  flowScore,
  circleNodes,
  circlePositionOf,
  CIRCLE_MAJORS,
  type FlowRelation,
} from "@/lib/keyFlowExplain";

describe("explainFlow — relation classification", () => {
  test("same key (same tonic + mode)", () => {
    const e = explainFlow("G", "G");
    expect(e.relation).toBe("same");
    expect(e.distance).toBe(0);
    expect(e.badge).toBe("=");
    expect(e.detail).toContain("G");
  });

  test("relative minor is detected and named", () => {
    const e = explainFlow("C", "Am");
    expect(e.relation).toBe("relative");
    expect(e.label).toBe("Relative minor");
    expect(e.detail).toContain("relative minor");
  });

  test("relative major is detected from a minor from-key", () => {
    const e = explainFlow("Am", "C");
    expect(e.relation).toBe("relative");
    expect(e.label).toBe("Relative major");
  });

  test("parallel minor (same tonic, opposite mode)", () => {
    const e = explainFlow("C", "Cm");
    expect(e.relation).toBe("parallel");
    expect(e.label).toBe("Parallel minor");
    expect(e.distance).toBe(0); // same tonic pc → circle distance 0
  });

  test("a fifth away is the neighbour relation", () => {
    expect(explainFlow("C", "G").relation).toBe("neighbour"); // +1 dominant
    expect(explainFlow("C", "F").relation).toBe("neighbour"); // +1 subdominant
    expect(explainFlow("C", "G").badge).toBe("+1");
  });

  test("two or three steps is the 'near' relation", () => {
    expect(explainFlow("C", "D").relation).toBe("near"); // 2 steps
    expect(explainFlow("C", "A").relation).toBe("near"); // 3 steps
    expect(explainFlow("C", "D").label).toBe("2 steps away");
  });

  test("far side of the circle is 'distant'; the tritone is named", () => {
    const tritone = explainFlow("C", "F#");
    expect(tritone.relation).toBe("distant");
    expect(tritone.distance).toBe(6);
    expect(tritone.label).toBe("Tritone away");
    expect(tritone.detail).toContain("tritone");
  });
});

describe("explainFlow — honest degradation", () => {
  test("unknown successor key → unknown relation, no score", () => {
    const e = explainFlow("C", null);
    expect(e.relation).toBe("unknown");
    expect(e.distance).toBeNull();
    expect(e.detail).toContain("tempo");
  });

  test("unparseable from-key → unknown relation", () => {
    const e = explainFlow("not-a-key", "C");
    expect(e.relation).toBe("unknown");
    expect(e.badge).toBe("?");
  });
});

describe("explainFlow — invariants", () => {
  const KEYS = ["C", "G", "D", "A", "E", "B", "F#", "Db", "Ab", "Eb", "Bb", "F", "Am", "Em", "Cm"];

  test("distance is always 0..6 and symmetric", () => {
    for (const a of KEYS) {
      for (const b of KEYS) {
        const ab = explainFlow(a, b).distance;
        const ba = explainFlow(b, a).distance;
        expect(ab).not.toBeNull();
        expect(ab!).toBeGreaterThanOrEqual(0);
        expect(ab!).toBeLessThanOrEqual(6);
        expect(ab).toBe(ba); // circle-of-fifths distance is symmetric
      }
    }
  });

  test("every relation category is reachable", () => {
    const seen = new Set<FlowRelation>();
    seen.add(explainFlow("C", "C").relation);
    seen.add(explainFlow("C", "Am").relation);
    seen.add(explainFlow("C", "Cm").relation);
    seen.add(explainFlow("C", "G").relation);
    seen.add(explainFlow("C", "D").relation);
    seen.add(explainFlow("C", "F#").relation);
    seen.add(explainFlow("C", null).relation);
    expect(seen).toEqual(
      new Set<FlowRelation>(["same", "relative", "parallel", "neighbour", "near", "distant", "unknown"]),
    );
  });

  test("classification agrees with the engine's score ordering", () => {
    // The closer the relation, the higher the engine score it implies.
    const same = flowScore("C", "C")!;
    const relative = flowScore("C", "Am")!;
    const parallel = flowScore("C", "Cm")!;
    const neighbour = flowScore("C", "G")!;
    const distant = flowScore("C", "F#")!;
    expect(same).toBeGreaterThan(relative);
    expect(relative).toBeGreaterThan(parallel);
    expect(parallel).toBeGreaterThan(neighbour);
    expect(neighbour).toBeGreaterThan(distant);
  });
});

describe("flowScore", () => {
  test("same key scores 1, unknown returns null", () => {
    expect(flowScore("E", "E")).toBe(1);
    expect(flowScore("E", "")).toBeNull();
    expect(flowScore(null, "E")).toBeNull();
  });
});

describe("circle-of-fifths geometry", () => {
  test("twelve nodes, C at the top, clockwise by fifths", () => {
    const nodes = circleNodes();
    expect(nodes).toHaveLength(12);
    expect(nodes[0]!.key).toBe("C");
    expect(nodes[0]!.angle).toBe(0);
    expect(nodes[1]!.key).toBe("G"); // a fifth clockwise from C
    expect(nodes[11]!.key).toBe("F"); // a fifth counter-clockwise
    // angles strictly increase around the ring
    for (let i = 1; i < nodes.length; i++) {
      expect(nodes[i]!.angle).toBeGreaterThan(nodes[i - 1]!.angle);
    }
  });

  test("circlePositionOf agrees with the labelled ring, ignoring mode", () => {
    CIRCLE_MAJORS.forEach((key, i) => {
      expect(circlePositionOf(key)).toBe(i);
    });
    // minor keys fold onto their tonic's position; enharmonics too
    expect(circlePositionOf("Am")).toBe(circlePositionOf("A"));
    expect(circlePositionOf("Gb")).toBe(circlePositionOf("F#"));
  });

  test("unparseable key has no position", () => {
    expect(circlePositionOf("nope")).toBeNull();
    expect(circlePositionOf(null)).toBeNull();
  });
});
