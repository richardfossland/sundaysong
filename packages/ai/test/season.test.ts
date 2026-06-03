/**
 * Tests for recommendation use case C — "songs that fit a liturgical season".
 *
 * Package-layer unit tests for the pure, offline ranker. Covers:
 *  1. SEASON_DEFINITIONS structure (sanity checks)
 *  2. rankSeason pure ranker (keyword + semantic scoring)
 *  3. buildSeasonSummary helper
 *  4. rankSeason + buildSeasonSummary together
 *
 * All tests are pure computation — no DB, no network, no LLM. The route layer
 * (POST /v1/recommend/season) is exercised separately in
 * apps/api/test/recommendSeason.test.ts.
 */

import { describe, expect, test } from "bun:test";

import { rankSeason, buildSeasonSummary, SEASON_DEFINITIONS, type SeasonCandidate } from "../src/season";

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeCandidates = (): SeasonCandidate[] => [
  { id: "a", title: "O Come O Come Emmanuel",   themes: ["advent", "hope", "waiting"],          semantic_score: 0.8 },
  { id: "b", title: "Joy to the World",         themes: ["christmas", "joy", "nativity"],       semantic_score: 0.75 },
  { id: "c", title: "Amazing Grace",            themes: ["grace", "forgiveness", "mercy"],      semantic_score: 0.3 },
  { id: "d", title: "Christ the Lord Is Risen", themes: ["easter", "resurrection", "alleluia"], semantic_score: 0.85 },
  { id: "e", title: "Come Holy Spirit",         themes: ["pentecost", "holy spirit", "fire"],   semantic_score: 0.9 },
  { id: "f", title: "Hosanna",                  themes: ["palm sunday", "hosanna", "holy week"], semantic_score: 0.7 },
  { id: "g", title: "In Christ Alone",          themes: ["faith", "cross", "resurrection"],      semantic_score: 0.5 },
];

// ── 1. SEASON_DEFINITIONS ─────────────────────────────────────────────────────

describe("SEASON_DEFINITIONS", () => {
  const seasons = [
    "Advent", "Christmas", "Epiphany", "Lent", "HolyWeek",
    "Easter", "Pentecost", "Trinity", "AllSaints", "OrdinaryTime",
  ] as const;

  test("all 10 seasons are defined", () => {
    expect(Object.keys(SEASON_DEFINITIONS)).toHaveLength(10);
    for (const s of seasons) {
      expect(SEASON_DEFINITIONS[s]).toBeDefined();
    }
  });

  test("every definition has a non-empty name and Norwegian name", () => {
    for (const def of Object.values(SEASON_DEFINITIONS)) {
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.nameNo.length).toBeGreaterThan(0);
    }
  });

  test("every definition has a non-empty query string", () => {
    for (const def of Object.values(SEASON_DEFINITIONS)) {
      expect(def.query.length).toBeGreaterThan(10);
    }
  });

  test("every definition has at least 2 primary keywords", () => {
    for (const def of Object.values(SEASON_DEFINITIONS)) {
      expect(def.primaryKeywords.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("every definition has at least 2 secondary keywords", () => {
    for (const def of Object.values(SEASON_DEFINITIONS)) {
      expect(def.secondaryKeywords.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("every definition has a non-empty description", () => {
    for (const def of Object.values(SEASON_DEFINITIONS)) {
      expect(def.description.length).toBeGreaterThan(10);
    }
  });
});

// ── 2. rankSeason pure ranker ─────────────────────────────────────────────────

describe("rankSeason", () => {
  test("Advent: Emmanuel/hope song ranks above Christmas song", () => {
    const { picks } = rankSeason("Advent", makeCandidates(), 10);
    const emmanuelIdx = picks.findIndex((p) => p.song_id === "a");
    const christmasIdx = picks.findIndex((p) => p.song_id === "b");
    // If both are in picks, the Advent-themed song should rank higher.
    if (emmanuelIdx !== -1 && christmasIdx !== -1) {
      expect(emmanuelIdx).toBeLessThan(christmasIdx);
    }
  });

  test("Christmas: Joy to the World ranks in top 3", () => {
    const { picks } = rankSeason("Christmas", makeCandidates(), 10);
    const idx = picks.findIndex((p) => p.song_id === "b");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(3);
  });

  test("Easter: resurrection song ranks highest", () => {
    const { picks } = rankSeason("Easter", makeCandidates(), 10);
    expect(picks.length).toBeGreaterThan(0);
    expect(picks[0]!.song_id).toBe("d");
  });

  test("Pentecost: Holy Spirit song ranks highest", () => {
    const { picks } = rankSeason("Pentecost", makeCandidates(), 10);
    expect(picks.length).toBeGreaterThan(0);
    expect(picks[0]!.song_id).toBe("e");
  });

  test("HolyWeek: Hosanna / palm sunday song ranks highly", () => {
    const { picks } = rankSeason("HolyWeek", makeCandidates(), 10);
    const hosannaIdx = picks.findIndex((p) => p.song_id === "f");
    expect(hosannaIdx).toBeGreaterThanOrEqual(0);
    expect(hosannaIdx).toBeLessThan(3);
  });

  test("picks are sorted by descending score", () => {
    const { picks } = rankSeason("Easter", makeCandidates(), 10);
    for (let i = 1; i < picks.length; i++) {
      expect(picks[i - 1]!.score).toBeGreaterThanOrEqual(picks[i]!.score);
    }
  });

  test("all scores stay in 0..1", () => {
    for (const season of ["Advent", "Christmas", "Easter", "Pentecost", "Lent"] as const) {
      const { picks } = rankSeason(season, makeCandidates(), 10);
      for (const p of picks) {
        expect(p.score).toBeGreaterThanOrEqual(0);
        expect(p.score).toBeLessThanOrEqual(1);
      }
    }
  });

  test("keyword matching is case-insensitive", () => {
    const upper: SeasonCandidate[] = [
      { id: "u", title: "ADVENT HOPE", themes: ["WAITING", "EXPECTATION"], semantic_score: 0 },
    ];
    const { picks } = rankSeason("Advent", upper, 5);
    expect(picks).toHaveLength(1);
    // primary "advent" + "waiting" + "hope" + "expectation" → at least 0.6 cap.
    expect(picks[0]!.score).toBeGreaterThan(0.3);
  });

  test("keyword matching is substring-based", () => {
    // "nations" (secondary, Epiphany) is a substring of the title word.
    const sub: SeasonCandidate[] = [
      { id: "s", title: "Light to the nationsong", themes: [], semantic_score: 0 },
    ];
    const { picks } = rankSeason("Epiphany", sub, 5);
    expect(picks[0]!.score).toBeGreaterThan(0);
  });

  test("score follows formula: semantic × 0.5 + primary boost + secondary boost", () => {
    // Easter: title "Risen" → primary "risen" (0.3); theme "victory" → secondary (0.15).
    // semantic 0.4 → 0.2. Total = 0.2 + 0.3 + 0.15 = 0.65.
    const c: SeasonCandidate[] = [
      { id: "z", title: "He Is Risen", themes: ["victory"], semantic_score: 0.4 },
    ];
    const { picks } = rankSeason("Easter", c, 5);
    expect(picks[0]!.score).toBeCloseTo(0.65, 3);
  });

  test("primary boost is capped at 0.6", () => {
    // Advent has 7 primary keywords; match 4+ → would exceed 0.6 uncapped.
    const c: SeasonCandidate[] = [
      {
        id: "p",
        title: "advent waiting hope prepare expectation maranatha",
        themes: [],
        semantic_score: 0,
      },
    ];
    const { picks } = rankSeason("Advent", c, 5);
    // Pure primary contribution is capped at 0.6 (no secondary, no semantic).
    expect(picks[0]!.score).toBeLessThanOrEqual(0.6);
  });

  test("limit is respected", () => {
    const { picks } = rankSeason("Easter", makeCandidates(), 2);
    expect(picks.length).toBeLessThanOrEqual(2);
  });

  test("default limit is 5", () => {
    const { picks } = rankSeason("OrdinaryTime", makeCandidates());
    expect(picks.length).toBeLessThanOrEqual(5);
  });

  test("empty candidates returns empty picks without throwing", () => {
    const { picks } = rankSeason("Advent", [], 5);
    expect(picks).toHaveLength(0);
  });

  test("each pick has a non-empty reason string", () => {
    const { picks } = rankSeason("Christmas", makeCandidates(), 10);
    for (const p of picks) {
      expect(typeof p.reason).toBe("string");
      expect(p.reason.length).toBeGreaterThan(0);
    }
  });

  test("reason cites season themes when primary keywords match", () => {
    const c: SeasonCandidate[] = [
      { id: "r", title: "Easter Alleluia", themes: ["resurrection"], semantic_score: 0 },
    ];
    const { picks } = rankSeason("Easter", c, 5);
    expect(picks[0]!.reason).toContain("season themes");
  });

  test("reason notes semantic closeness when semantic score is high", () => {
    const c: SeasonCandidate[] = [
      { id: "r", title: "Unknown Hymn", themes: [], semantic_score: 0.9 },
    ];
    const { picks } = rankSeason("Advent", c, 5);
    expect(picks[0]!.reason).toContain("semantically close");
  });

  test("reason falls back to catalog match when nothing matches", () => {
    // No keyword match, low semantic (<= 0.15) → generic fallback reason.
    const c: SeasonCandidate[] = [
      { id: "r", title: "Random Tune", themes: ["nothing"], semantic_score: 0.1 },
    ];
    const { picks } = rankSeason("Trinity", c, 5);
    expect(picks[0]!.reason).toContain("catalog match for Trinity");
  });

  test("candidate with only semantic score (no themes) still gets a pick", () => {
    const noTheme: SeasonCandidate[] = [
      { id: "x", title: "Unknown Hymn", themes: [], semantic_score: 0.9 },
    ];
    const { picks } = rankSeason("Advent", noTheme, 5);
    expect(picks).toHaveLength(1);
    expect(picks[0]!.score).toBeGreaterThan(0);
    // semantic 0.9 × 0.5 = 0.45.
    expect(picks[0]!.score).toBeCloseTo(0.45, 3);
  });

  test("candidate with zero semantic score but strong keyword match still scores", () => {
    const keywordOnly: SeasonCandidate[] = [
      { id: "k", title: "Advent Candle Song", themes: ["advent", "waiting", "hope"], semantic_score: 0 },
    ];
    const { picks } = rankSeason("Advent", keywordOnly, 5);
    expect(picks).toHaveLength(1);
    expect(picks[0]!.score).toBeGreaterThan(0.2);
  });

  test("candidate with zero semantic score and no keyword match scores zero", () => {
    const nothing: SeasonCandidate[] = [
      { id: "n", title: "Random Tune", themes: ["unrelated"], semantic_score: 0 },
    ];
    const { picks } = rankSeason("Lent", nothing, 5);
    expect(picks).toHaveLength(1);
    expect(picks[0]!.score).toBe(0);
  });

  test("pick carries id and title through unchanged", () => {
    const { picks } = rankSeason("Easter", makeCandidates(), 10);
    const easter = picks.find((p) => p.song_id === "d");
    expect(easter).toBeDefined();
    expect(easter!.title).toBe("Christ the Lord Is Risen");
  });
});

// ── 3. buildSeasonSummary ─────────────────────────────────────────────────────

describe("buildSeasonSummary", () => {
  test("zero picks returns a helpful no-match message", () => {
    const summary = buildSeasonSummary("Lent", 0);
    expect(summary).toContain("Lent");
    expect(summary).toContain("No catalog songs matched");
    expect(summary.length).toBeGreaterThan(20);
  });

  test("one pick uses singular form", () => {
    const summary = buildSeasonSummary("Easter", 1);
    expect(summary).toContain("1 song");
    expect(summary).not.toContain("1 songs");
  });

  test("many picks uses plural form", () => {
    const summary = buildSeasonSummary("Christmas", 5);
    expect(summary).toContain("5 songs");
  });

  test("non-empty summary includes the season description", () => {
    const summary = buildSeasonSummary("Advent", 3);
    expect(summary).toContain(SEASON_DEFINITIONS.Advent.description);
  });

  test("summary always contains the season name", () => {
    for (const season of ["Advent", "Pentecost", "Trinity"] as const) {
      const s = buildSeasonSummary(season, 3);
      expect(s).toContain(SEASON_DEFINITIONS[season].name);
    }
  });
});

// ── 4. rankSeason + buildSeasonSummary together ───────────────────────────────

describe("rankSeason + buildSeasonSummary integration", () => {
  test("summary pluralization matches the number of picks", () => {
    const { picks } = rankSeason("Easter", makeCandidates(), 10);
    const summary = buildSeasonSummary("Easter", picks.length);
    expect(summary).toContain(`${picks.length} song`);
  });

  test("empty candidates produce the no-match summary", () => {
    const { picks } = rankSeason("AllSaints", [], 5);
    const summary = buildSeasonSummary("AllSaints", picks.length);
    expect(summary).toContain("No catalog songs matched");
    expect(summary).toContain("All Saints");
  });
});
