/**
 * Tests for recommendation use case C — "songs that fit a liturgical season".
 *
 * Covers:
 *  1. SEASON_DEFINITIONS structure (sanity checks)
 *  2. rankSeason pure ranker (keyword + semantic scoring)
 *  3. buildSeasonSummary helper
 *  4. POST /v1/recommend/season (route via _candidates injection)
 *
 * All tests are offline — no DB, no network, no LLM required.
 * The _candidates injection bypasses the DB path, matching the approach
 * used by the `recommendAfter` tests.
 */

import { describe, expect, test } from "bun:test";

import { rankSeason, buildSeasonSummary, SEASON_DEFINITIONS, type SeasonCandidate } from "@sundaysong/ai";
import { recommendSeasonRoutes } from "../src/routes/recommendSeason";

// ── Helpers ───────────────────────────────────────────────────────────────────

const post = (body: unknown) =>
  recommendSeasonRoutes.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const makeCandidates = (): SeasonCandidate[] => [
  { id: "a", title: "O Come O Come Emmanuel",  themes: ["advent", "hope", "waiting"],     semantic_score: 0.8 },
  { id: "b", title: "Joy to the World",        themes: ["christmas", "joy", "nativity"],   semantic_score: 0.75 },
  { id: "c", title: "Amazing Grace",            themes: ["grace", "forgiveness", "mercy"],  semantic_score: 0.3 },
  { id: "d", title: "Christ the Lord Is Risen", themes: ["easter", "resurrection", "alleluia"], semantic_score: 0.85 },
  { id: "e", title: "Come Holy Spirit",         themes: ["pentecost", "holy spirit", "fire"],   semantic_score: 0.9 },
  { id: "f", title: "Hosanna",                  themes: ["palm sunday", "hosanna", "holy week"], semantic_score: 0.7 },
  { id: "g", title: "In Christ Alone",          themes: ["faith", "cross", "resurrection"],      semantic_score: 0.5 },
];

// ── 1. SEASON_DEFINITIONS ─────────────────────────────────────────────────────

describe("SEASON_DEFINITIONS", () => {
  test("all 10 seasons are defined", () => {
    const seasons = [
      "Advent", "Christmas", "Epiphany", "Lent", "HolyWeek",
      "Easter", "Pentecost", "Trinity", "AllSaints", "OrdinaryTime",
    ] as const;
    for (const s of seasons) {
      expect(SEASON_DEFINITIONS[s]).toBeDefined();
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

  test("every definition has a non-empty description", () => {
    for (const def of Object.values(SEASON_DEFINITIONS)) {
      expect(def.description.length).toBeGreaterThan(10);
    }
  });
});

// ── 2. rankSeason pure ranker ─────────────────────────────────────────────────

describe("rankSeason", () => {
  test("Advent: Emmanuel/hope song ranks above Christmas song", () => {
    const { picks } = rankSeason("Advent", makeCandidates());
    const emmanuelIdx = picks.findIndex((p) => p.song_id === "a");
    const christmasIdx = picks.findIndex((p) => p.song_id === "b");
    // If both are in picks, Advent song should rank higher.
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

  test("all scores stay in 0..1", () => {
    for (const season of ["Advent", "Christmas", "Easter", "Pentecost", "Lent"] as const) {
      const { picks } = rankSeason(season, makeCandidates(), 10);
      for (const p of picks) {
        expect(p.score).toBeGreaterThanOrEqual(0);
        expect(p.score).toBeLessThanOrEqual(1);
      }
    }
  });

  test("limit is respected", () => {
    const { picks } = rankSeason("Easter", makeCandidates(), 2);
    expect(picks.length).toBeLessThanOrEqual(2);
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

  test("candidate with only semantic score (no themes) still gets a pick", () => {
    const noTheme: SeasonCandidate[] = [
      { id: "x", title: "Unknown Hymn", themes: [], semantic_score: 0.9 },
    ];
    const { picks } = rankSeason("Advent", noTheme, 5);
    expect(picks.length).toBe(1);
    expect(picks[0]!.score).toBeGreaterThan(0);
  });

  test("candidate with zero semantic score but strong keyword match still scores", () => {
    const keywordOnly: SeasonCandidate[] = [
      { id: "k", title: "Advent Candle Song", themes: ["advent", "waiting", "hope"], semantic_score: 0 },
    ];
    const { picks } = rankSeason("Advent", keywordOnly, 5);
    expect(picks.length).toBe(1);
    expect(picks[0]!.score).toBeGreaterThan(0.2);
  });
});

// ── 3. buildSeasonSummary ─────────────────────────────────────────────────────

describe("buildSeasonSummary", () => {
  test("zero picks returns a helpful no-match message", () => {
    const summary = buildSeasonSummary("Lent", 0);
    expect(summary).toContain("Lent");
    expect(summary.length).toBeGreaterThan(20);
  });

  test("one pick uses singular form", () => {
    const summary = buildSeasonSummary("Easter", 1);
    expect(summary).toContain("1 song");
  });

  test("many picks uses plural form", () => {
    const summary = buildSeasonSummary("Christmas", 5);
    expect(summary).toContain("5 songs");
  });

  test("summary always contains the season name", () => {
    for (const season of ["Advent", "Pentecost", "Trinity"] as const) {
      const s = buildSeasonSummary(season, 3);
      expect(s).toContain(SEASON_DEFINITIONS[season].name);
    }
  });
});

// ── 4. POST /v1/recommend/season route ───────────────────────────────────────

describe("POST /v1/recommend/season", () => {
  const candidates: SeasonCandidate[] = [
    { id: "s1", title: "Come Lord Jesus",   themes: ["advent", "waiting"],     semantic_score: 0.8 },
    { id: "s2", title: "O Holy Night",      themes: ["christmas", "nativity"], semantic_score: 0.75 },
    { id: "s3", title: "Alleluia He Rises", themes: ["easter", "alleluia"],    semantic_score: 0.9 },
  ];

  test("200 with valid season + _candidates", async () => {
    const res = await post({ season: "Advent", _candidates: candidates });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { season: string; picks: unknown[]; summary: string };
    expect(json.season).toBe("Advent");
    expect(Array.isArray(json.picks)).toBe(true);
    expect(json.picks.length).toBeGreaterThan(0);
    expect(typeof json.summary).toBe("string");
  });

  test("400 on missing season", async () => {
    const res = await post({ _candidates: candidates });
    expect(res.status).toBe(400);
  });

  test("400 on invalid season value", async () => {
    const res = await post({ season: "InvalidSeason", _candidates: candidates });
    expect(res.status).toBe(400);
  });

  test("400 on limit out of range (> 20)", async () => {
    const res = await post({ season: "Easter", limit: 99, _candidates: candidates });
    expect(res.status).toBe(400);
  });

  test("respects limit parameter", async () => {
    const res = await post({ season: "Christmas", limit: 2, _candidates: candidates });
    const json = (await res.json()) as { picks: unknown[] };
    expect(json.picks.length).toBeLessThanOrEqual(2);
  });

  test("Easter picks include resurrection song when present", async () => {
    const res = await post({ season: "Easter", limit: 5, _candidates: candidates });
    const json = (await res.json()) as { picks: Array<{ song_id: string }> };
    const ids = json.picks.map((p) => p.song_id);
    expect(ids).toContain("s3"); // alleluia/easter themed
  });

  test("Advent picks rank advent-themed song above christmas song", async () => {
    const res = await post({ season: "Advent", limit: 3, _candidates: candidates });
    const json = (await res.json()) as { picks: Array<{ song_id: string }> };
    const adventIdx = json.picks.findIndex((p) => p.song_id === "s1");
    const christmasIdx = json.picks.findIndex((p) => p.song_id === "s2");
    if (adventIdx !== -1 && christmasIdx !== -1) {
      expect(adventIdx).toBeLessThan(christmasIdx);
    }
  });

  test("response picks have required fields", async () => {
    const res = await post({ season: "Pentecost", _candidates: candidates });
    const json = (await res.json()) as { picks: Array<{ song_id: string; title: string; score: number; reason: string }> };
    for (const p of json.picks) {
      expect(typeof p.song_id).toBe("string");
      expect(typeof p.title).toBe("string");
      expect(typeof p.score).toBe("number");
      expect(typeof p.reason).toBe("string");
    }
  });

  test("empty _candidates returns 200 with empty picks + summary", async () => {
    const res = await post({ season: "AllSaints", _candidates: [] });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { picks: unknown[] };
    expect(json.picks).toHaveLength(0);
  });
});
