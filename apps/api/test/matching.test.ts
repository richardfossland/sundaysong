/**
 * Tests for cross-language matching (Phase 3.3) — "is this song a translation
 * of one we already have?".
 *
 * Covers the two API routes, which inline the pure matching logic:
 *  1. POST /v1/matching/score      — scoreTranslationCandidate contract
 *  2. POST /v1/matching/candidates — proposeCandidates contract
 *
 * The routes are pure (no DB), so these run fully offline — no DB, no network,
 * no LLM. They assert the route contracts and the Zod schemas; the underlying
 * scoring logic is unit-tested in packages/matching.
 */

import { describe, expect, test } from "bun:test";

import type { CandidateScore, MatchSong } from "@sundaysong/matching";
import { matchingRoutes } from "../src/routes/matching";

// ── Helpers ───────────────────────────────────────────────────────────────────

const post = (path: string, body: unknown) =>
  matchingRoutes.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

// Fixtures mirror packages/matching/test/candidates.test.ts.
const lordEn: MatchSong = {
  id: "en1",
  canonical_title: "Lord I Lift Your Name on High",
  language: "en",
  themes: ["praise", "exaltation"],
  bible_refs: ["Psalm 18:46", "2 Samuel 22:47"],
  year_first_published: 1989,
  composer_ids: ["rick-founds"],
};

const herreNo: MatchSong = {
  id: "no1",
  canonical_title: "Herre, jeg løfter ditt navn",
  language: "nb",
  themes: ["praise", "exaltation", "worship"],
  bible_refs: ["Psalm 18:46"],
  year_first_published: 1995,
  composer_ids: ["rick-founds"],
};

// ── 1. POST /v1/matching/score ────────────────────────────────────────────────

describe("POST /v1/matching/score", () => {
  test("200 — canonical cross-language pair is proposed for review", async () => {
    const res = await post("/score", { a: lordEn, b: herreNo });
    expect(res.status).toBe(200);
    const json = (await res.json()) as CandidateScore;
    expect(json.a_id).toBe("en1");
    expect(json.b_id).toBe("no1");
    expect(json.recommendation).toBe("propose");
    expect(json.confidence).toBeGreaterThan(0.5);
    expect(json.confidence).toBeLessThan(0.8);
    expect(Array.isArray(json.signals)).toBe(true);
  });

  test("200 — shared CCLI registration pushes the pair to auto-link", async () => {
    const res = await post("/score", {
      a: { ...lordEn, ccli_song_id: "117947" },
      b: { ...herreNo, ccli_song_id: "117947" },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as CandidateScore;
    expect(json.recommendation).toBe("auto_link");
    expect(json.confidence).toBeGreaterThanOrEqual(0.8);
    expect(json.signals.map((s) => s.name)).toContain("shared_ccli");
  });

  test("200 — same language is rejected (never a translation)", async () => {
    const res = await post("/score", { a: lordEn, b: { ...herreNo, language: "en" } });
    expect(res.status).toBe(200);
    const json = (await res.json()) as CandidateScore;
    expect(json.recommendation).toBe("reject");
    expect(json.confidence).toBe(0);
    expect(json.signals.map((s) => s.name)).toEqual(["same_language"]);
  });

  test("200 — each signal has a name and a numeric weight", async () => {
    const res = await post("/score", { a: lordEn, b: herreNo });
    const json = (await res.json()) as CandidateScore;
    for (const s of json.signals) {
      expect(typeof s.name).toBe("string");
      expect(typeof s.weight).toBe("number");
    }
  });

  test("400 — missing the second song", async () => {
    const res = await post("/score", { a: lordEn });
    expect(res.status).toBe(400);
  });

  test("400 — song missing required canonical_title", async () => {
    const res = await post("/score", {
      a: { id: "x", language: "en" },
      b: herreNo,
    });
    expect(res.status).toBe(400);
  });

  test("400 — language shorter than the 2-char minimum", async () => {
    const res = await post("/score", { a: { ...lordEn, language: "e" }, b: herreNo });
    expect(res.status).toBe(400);
  });
});

// ── 2. POST /v1/matching/candidates ───────────────────────────────────────────

describe("POST /v1/matching/candidates", () => {
  const pool: MatchSong[] = [
    herreNo, // propose
    { ...herreNo, id: "no2", ccli_song_id: "117947" }, // auto-link (shared ccli with target)
    {
      id: "x",
      canonical_title: "Different Song",
      language: "sv",
      themes: ["x"],
      bible_refs: ["y"],
      year_first_published: 1700,
    }, // reject
  ];

  test("200 — ranks links best-first and excludes rejects", async () => {
    const res = await post("/candidates", { target: { ...lordEn, ccli_song_id: "117947" }, pool });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { target_id: string; candidates: CandidateScore[] };
    expect(json.target_id).toBe("en1");
    expect(json.candidates).toHaveLength(2);
    expect(json.candidates[0]!.b_id).toBe("no2"); // auto-link scores highest
    expect(json.candidates[0]!.confidence).toBeGreaterThanOrEqual(json.candidates[1]!.confidence);
    expect(json.candidates.map((c) => c.b_id)).not.toContain("x");
  });

  test("200 — excludes the target itself from the pool", async () => {
    const res = await post("/candidates", { target: lordEn, pool: [lordEn, herreNo] });
    const json = (await res.json()) as { candidates: CandidateScore[] };
    expect(json.candidates.map((c) => c.b_id)).toEqual(["no1"]);
  });

  test("200 — min_confidence filters out everything below the threshold", async () => {
    const res = await post("/candidates", {
      target: { ...lordEn, ccli_song_id: "117947" },
      pool,
      min_confidence: 0.8,
    });
    const json = (await res.json()) as { candidates: CandidateScore[] };
    // Only the auto-link (shared ccli) candidate clears 0.8.
    expect(json.candidates).toHaveLength(1);
    expect(json.candidates[0]!.b_id).toBe("no2");
  });

  test("200 — empty pool returns no candidates", async () => {
    const res = await post("/candidates", { target: lordEn, pool: [] });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { candidates: CandidateScore[] };
    expect(json.candidates).toHaveLength(0);
  });

  test("400 — missing the target", async () => {
    const res = await post("/candidates", { pool });
    expect(res.status).toBe(400);
  });

  test("400 — pool is not an array", async () => {
    const res = await post("/candidates", { target: lordEn, pool: "nope" });
    expect(res.status).toBe(400);
  });

  test("400 — min_confidence outside the 0..1 range", async () => {
    const res = await post("/candidates", { target: lordEn, pool, min_confidence: 1.5 });
    expect(res.status).toBe(400);
  });
});
