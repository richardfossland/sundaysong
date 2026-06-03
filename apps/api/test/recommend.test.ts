/**
 * Integration tests for POST /v1/recommend — the main recommendation engine.
 *
 * This is the strategic differentiator: embedding retrieval → heuristic
 * ranking + explanations → optional LLM re-rank → key-flow ordering (use case
 * B) → energy-arc sequencing (use case D), all grounded in the real catalog.
 *
 * Every test runs OFFLINE — no DB, no embedder, no LLM. We inject a fully
 * hydrated candidate pool via the route-only `_picks` field (mirroring the
 * `_candidates` seam in /recommend/after and /recommend/season). With `_picks`
 * present the route skips pgvector + `listVariantsForSong` entirely, so we
 * exercise the ranking/flow/arc logic against deterministic fixtures.
 *
 * The LLM path is never taken here: `getLlmClient()` returns null without an
 * ANTHROPIC_API_KEY, so `rerankPicks` collapses to the heuristic `rankPicks`
 * (`reranked: false`). That is the free-tier behaviour and what we assert.
 */

import { describe, expect, test } from "bun:test";

import type { Song } from "@sundaysong/shared";
import { recommendRoutes } from "../src/routes/recommend";

// ── Helpers ───────────────────────────────────────────────────────────────────

const post = (body: unknown) =>
  recommendRoutes.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** A minimal-but-complete catalog Song; override only what a test cares about. */
const song = (over: Partial<Song> & { id: string }): Song => ({
  canonical_title: over.id,
  original_language: "en",
  year_first_published: null,
  copyright_status: "public_domain",
  ccli_song_id: null,
  tono_work_id: null,
  tono_registered: false,
  hymnary_id: null,
  popularity_score: 50,
  nordic_metadata: {},
  themes: [],
  bible_refs: [],
  created_at: "2025-01-01T00:00:00.000Z",
  updated_at: "2025-01-01T00:00:00.000Z",
  ...over,
});

/** One entry in the injected `_picks` pool (song + retrieval + variant meta). */
interface InjectedPick {
  song: Song;
  semantic_score?: number;
  key?: string | null;
  bpm?: number | null;
}

const pick = (p: InjectedPick) => ({
  song: p.song,
  semantic_score: p.semantic_score ?? 0,
  key: p.key ?? null,
  bpm: p.bpm ?? null,
});

/** The route response (a superset of the RecommendOutput contract). */
interface RecommendResponse {
  picks: Array<{ song: Song; reason: string; suggested_key?: string }>;
  total_minutes_estimate: number;
  summary: string;
  reranked: boolean;
  key_flow: boolean;
  arc?: string;
}

// ── (a) basic ranking + explanations ──────────────────────────────────────────

describe("POST /v1/recommend — basic ranking", () => {
  test("200 and ranks the on-theme, high-semantic song first", async () => {
    const res = await post({
      theme: "grace",
      _picks: [
        pick({ song: song({ id: "off", themes: ["judgement"] }), semantic_score: 0.1 }),
        pick({ song: song({ id: "on", themes: ["grace"] }), semantic_score: 0.9 }),
      ],
    });
    expect(res.status).toBe(200);

    const json = (await res.json()) as RecommendResponse;
    expect(json.picks[0]!.song.id).toBe("on");
  });

  test("each pick carries a non-empty reason mentioning the theme", async () => {
    const res = await post({
      theme: "hope",
      _picks: [pick({ song: song({ id: "s1", themes: ["hope", "comfort"] }), semantic_score: 0.7 })],
    });
    const json = (await res.json()) as RecommendResponse;

    expect(json.picks).toHaveLength(1);
    const reason = json.picks[0]!.reason;
    expect(typeof reason).toBe("string");
    expect(reason.length).toBeGreaterThan(0);
    expect(reason.toLowerCase()).toContain("hope");
  });

  test("response shape matches the RecommendOutput contract", async () => {
    const res = await post({
      theme: "worship",
      _picks: [pick({ song: song({ id: "a" }), semantic_score: 0.5 })],
    });
    const json = (await res.json()) as RecommendResponse;

    // RecommendOutput core fields
    expect(Array.isArray(json.picks)).toBe(true);
    expect(typeof json.total_minutes_estimate).toBe("number");
    expect(typeof json.summary).toBe("string");
    expect(typeof json.reranked).toBe("boolean");
    // Each pick hydrates the full song (no leaked `score`) + a reason
    const p = json.picks[0]!;
    expect(p.song.id).toBe("a");
    expect(p).not.toHaveProperty("score");
    expect(p.song).not.toHaveProperty("score");
    expect(typeof p.reason).toBe("string");
  });

  test("duration_min packs roughly one song per 4 minutes", async () => {
    const picks = Array.from({ length: 10 }, (_, i) =>
      pick({ song: song({ id: `s${i}` }), semantic_score: 0.5 }),
    );
    const res = await post({ theme: "joy", duration_min: 12, _picks: picks });
    const json = (await res.json()) as RecommendResponse;

    // ~12 min / 4 min-per-song ≈ 3 picks; estimate tracks chosen count.
    expect(json.picks).toHaveLength(3);
    expect(json.total_minutes_estimate).toBe(12);
  });

  test("language filter drops candidates in other languages", async () => {
    const res = await post({
      theme: "grace",
      language: "no",
      _picks: [
        pick({ song: song({ id: "en1", original_language: "en", themes: ["grace"] }), semantic_score: 0.8 }),
        pick({ song: song({ id: "no1", original_language: "no", themes: ["grace"] }), semantic_score: 0.4 }),
      ],
    });
    const json = (await res.json()) as RecommendResponse;

    expect(json.picks.map((p) => p.song.id)).toEqual(["no1"]);
  });
});

// ── (b) key-flow reordering when after_song_id given ──────────────────────────

describe("POST /v1/recommend — key flow (use case B)", () => {
  const AFTER_ID = "11111111-1111-1111-1111-111111111111";

  test("key_flow:true and same-key pick is favoured when flowing from C", async () => {
    const res = await post({
      theme: "praise",
      after_song_id: AFTER_ID,
      _after_key: "C",
      _picks: [
        // Tritone away from C — should be pushed down by flow.
        pick({ song: song({ id: "tritone", themes: ["praise"] }), semantic_score: 0.5, key: "F#" }),
        // Same key as C — should be lifted by flow.
        pick({ song: song({ id: "same", themes: ["praise"] }), semantic_score: 0.5, key: "C" }),
      ],
    });
    const json = (await res.json()) as RecommendResponse;

    expect(json.key_flow).toBe(true);
    expect(json.picks[0]!.song.id).toBe("same");
    // The flow reason is appended to the heuristic reason.
    expect(json.picks[0]!.reason.toLowerCase()).toContain("flow");
  });

  test("key_flow:false when the from-key cannot be resolved", async () => {
    const res = await post({
      theme: "praise",
      after_song_id: AFTER_ID,
      // no _after_key → afterKey null → no flow applied
      _picks: [pick({ song: song({ id: "a", themes: ["praise"] }), semantic_score: 0.5, key: "C" })],
    });
    const json = (await res.json()) as RecommendResponse;

    expect(json.key_flow).toBe(false);
  });

  test("suggested_key is surfaced from the injected variant key", async () => {
    const res = await post({
      theme: "praise",
      _picks: [pick({ song: song({ id: "a" }), semantic_score: 0.5, key: "Eb" })],
    });
    const json = (await res.json()) as RecommendResponse;

    expect(json.picks[0]!.suggested_key).toBe("Eb");
  });
});

// ── (c) arc sequencing when arc requested ─────────────────────────────────────

describe("POST /v1/recommend — arc sequencing (use case D)", () => {
  test("rising arc echoes the requested arc and orders low→high energy", async () => {
    const res = await post({
      theme: "celebration",
      arc: "rising",
      _picks: [
        // High energy: fast tempo.
        pick({ song: song({ id: "fast", themes: ["celebration"] }), semantic_score: 0.5, bpm: 140 }),
        // Low energy: slow tempo.
        pick({ song: song({ id: "slow", themes: ["celebration"] }), semantic_score: 0.5, bpm: 60 }),
      ],
    });
    const json = (await res.json()) as RecommendResponse;

    expect(json.arc).toBe("rising");
    // Rising = gentle opener → peak closer, so the slow song leads.
    expect(json.picks[0]!.song.id).toBe("slow");
    expect(json.picks[json.picks.length - 1]!.song.id).toBe("fast");
  });

  test("reflective arc winds down (high energy leads)", async () => {
    const res = await post({
      theme: "stillness",
      arc: "reflective",
      _picks: [
        pick({ song: song({ id: "fast" }), semantic_score: 0.5, bpm: 150 }),
        pick({ song: song({ id: "slow" }), semantic_score: 0.5, bpm: 55 }),
      ],
    });
    const json = (await res.json()) as RecommendResponse;

    expect(json.arc).toBe("reflective");
    expect(json.picks[0]!.song.id).toBe("fast");
  });

  test("arc is omitted from the response when none is requested", async () => {
    const res = await post({
      theme: "grace",
      _picks: [pick({ song: song({ id: "a" }), semantic_score: 0.5 })],
    });
    const json = (await res.json()) as RecommendResponse;

    expect(json.arc).toBeUndefined();
  });
});

// ── (d) graceful degradation (no LLM, no embeddings) ──────────────────────────

describe("POST /v1/recommend — graceful degradation", () => {
  test("reranked:false without an LLM client (free tier / heuristic only)", async () => {
    const res = await post({
      theme: "grace",
      _picks: [pick({ song: song({ id: "a", themes: ["grace"] }), semantic_score: 0.6 })],
    });
    const json = (await res.json()) as RecommendResponse;

    // No ANTHROPIC_API_KEY in the test env → rerankPicks === rankPicks.
    expect(json.reranked).toBe(false);
  });

  test("no theme/scripture/description still ranks the injected pool", async () => {
    // queryText is empty (production would fall back to popular songs); with
    // `_picks` injected the route ranks them by popularity + semantic score.
    const res = await post({
      _picks: [
        pick({ song: song({ id: "popular", popularity_score: 90 }), semantic_score: 0 }),
        pick({ song: song({ id: "obscure", popularity_score: 1 }), semantic_score: 0 }),
      ],
    });
    const json = (await res.json()) as RecommendResponse;

    expect(json.picks[0]!.song.id).toBe("popular");
  });

  test("400 on an invalid arc value", async () => {
    const res = await post({ theme: "grace", arc: "banana", _picks: [] });
    expect(res.status).toBe(400);
  });

  test("400 when after_song_id is not a uuid", async () => {
    const res = await post({ theme: "grace", after_song_id: "not-a-uuid", _picks: [] });
    expect(res.status).toBe(400);
  });
});

// ── (e) empty picks edge case ─────────────────────────────────────────────────

describe("POST /v1/recommend — empty picks", () => {
  test("empty pool returns 200 with no picks and a helpful summary", async () => {
    const res = await post({ theme: "grace", _picks: [] });
    expect(res.status).toBe(200);

    const json = (await res.json()) as RecommendResponse;
    expect(json.picks).toHaveLength(0);
    expect(json.total_minutes_estimate).toBe(0);
    expect(json.summary.length).toBeGreaterThan(0);
    expect(json.reranked).toBe(false);
    expect(json.key_flow).toBe(false);
  });

  test("arc + key flow on an empty pool degrade to no-ops without throwing", async () => {
    const res = await post({
      theme: "grace",
      arc: "rising",
      after_song_id: "11111111-1111-1111-1111-111111111111",
      _after_key: "C",
      _picks: [],
    });
    const json = (await res.json()) as RecommendResponse;

    expect(res.status).toBe(200);
    expect(json.picks).toHaveLength(0);
    // applyKeyFlow / applyArc both no-op on an empty result.
    expect(json.key_flow).toBe(false);
    expect(json.arc).toBeUndefined();
  });
});
