import { describe, expect, test } from "bun:test";
import { scoreCandidate, rankPicks, type Candidate } from "../src/index";

const base: Omit<Candidate, "id" | "canonical_title" | "semantic_score"> = {
  themes: [],
  bible_refs: [],
  popularity_score: 0,
  language: "en",
};

const grace: Candidate = { ...base, id: "1", canonical_title: "Amazing Grace", themes: ["grace", "salvation"], bible_refs: ["Ephesians 2:8"], semantic_score: 0.5 };
const drums: Candidate = { ...base, id: "2", canonical_title: "Drum Song", themes: ["energy"], semantic_score: 0.1 };

describe("scoreCandidate", () => {
  test("theme hit boosts score and is explained", () => {
    const r = scoreCandidate({ theme: "grace" }, grace);
    expect(r.score).toBeGreaterThan(0.6 * 0.5); // semantic alone
    expect(r.reason.toLowerCase()).toContain("theme of grace");
  });

  test("scripture hit adds grounding reason", () => {
    const r = scoreCandidate({ scripture: "Ephesians 2:8" }, grace);
    expect(r.reason.toLowerCase()).toContain("ephesians");
  });

  test("always produces a reason even with no hits", () => {
    expect(scoreCandidate({}, drums).reason.length).toBeGreaterThan(0);
  });
});

describe("rankPicks", () => {
  test("ranks the on-theme song first", () => {
    const r = rankPicks({ theme: "grace" }, [drums, grace]);
    expect(r.picks[0]!.title).toBe("Amazing Grace");
  });

  test("duration packs a set sized to ~4 min/song", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ ...base, id: String(i), canonical_title: `S${i}`, semantic_score: 1 - i * 0.05 }));
    const r = rankPicks({ duration_min: 25 }, many);
    expect(r.picks).toHaveLength(6); // round(25/4)
    expect(r.total_minutes_estimate).toBe(24);
  });

  test("language filter excludes other languages", () => {
    const no: Candidate = { ...base, id: "n", canonical_title: "Stor er du Gud", language: "no", semantic_score: 0.9 };
    const r = rankPicks({ language: "en" }, [no, grace]);
    expect(r.picks.every((p) => p.title !== "Stor er du Gud")).toBe(true);
  });

  test("empty result has an actionable summary", () => {
    const r = rankPicks({ language: "de" }, [grace]);
    expect(r.picks).toHaveLength(0);
    expect(r.summary.toLowerCase()).toContain("no catalog songs");
  });
});
