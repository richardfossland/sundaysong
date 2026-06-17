/**
 * Integration tests for POST /v1/recommend/from-sermon — Sermon-to-Setlist.
 *
 * Offline: no DB, no embedder, no LLM. Extraction runs the keyword heuristic
 * (getLlmClient() is null without ANTHROPIC_API_KEY), and the candidate pool is
 * injected via the route-only `_picks` field (mirroring /v1/recommend). The
 * route's extract→rank→arc→coverage logic is exercised against deterministic
 * fixtures; the LLM extraction path itself is unit-tested in @sundaysong/ai.
 */

import { describe, expect, test } from "bun:test";

import type { Song } from "@sundaysong/shared";
import { recommendFromSermonRoutes } from "../src/routes/recommendFromSermon";

const post = (body: unknown) =>
  recommendFromSermonRoutes.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

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

const pick = (p: { song: Song; semantic_score?: number; key?: string | null; bpm?: number | null }) => ({
  song: p.song,
  semantic_score: p.semantic_score ?? 0,
  key: p.key ?? null,
  bpm: p.bpm ?? null,
});

interface SermonResponse {
  extract: { themes: string[]; scripture: string[]; arc: string | null; keywords: string[]; summary: string; source: "llm" | "heuristic" };
  picks: Array<{ song: Song; reason: string; suggested_key?: string; coverage?: { song_id: string; ccli_status: string; tono_status: string; gray_areas: string[] } }>;
  total_minutes_estimate: number;
  summary: string;
  reranked: boolean;
  arc?: string;
}

const MANUSCRIPT =
  "Den bortkomne sønn. I Lukas 15:11-32 møter vi nåde og tilgivelse. Nåde, nåde, nåde — det er hjertet.";

describe("POST /v1/recommend/from-sermon — validation", () => {
  test("400 when neither manuscript nor scripture refs nor _picks given", async () => {
    const res = await post({ title: "tom" });
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/recommend/from-sermon — keyless heuristic extraction", () => {
  test("200, extract.source=heuristic, themes + scripture pulled from the manuscript", async () => {
    const res = await post({
      manuscript: MANUSCRIPT,
      _picks: [
        pick({ song: song({ id: "grace", themes: ["nåde"] }), semantic_score: 0.9 }),
        pick({ song: song({ id: "off", themes: ["judgement"] }), semantic_score: 0.1 }),
      ],
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as SermonResponse;

    expect(json.extract.source).toBe("heuristic");
    expect(json.extract.themes).toContain("nåde");
    expect(json.extract.scripture.some((r) => /Lukas 15:11-32/i.test(r))).toBe(true);
    expect(json.reranked).toBe(false); // no LLM key → heuristic ranker
  });

  test("the on-theme, high-semantic song ranks first", async () => {
    const res = await post({
      manuscript: MANUSCRIPT,
      _picks: [
        pick({ song: song({ id: "off", themes: ["judgement"] }), semantic_score: 0.1 }),
        pick({ song: song({ id: "grace", themes: ["nåde"] }), semantic_score: 0.9 }),
      ],
    });
    const json = (await res.json()) as SermonResponse;
    expect(json.picks[0]!.song.id).toBe("grace");
  });

  test("explicit scripture_refs alone (no manuscript) is a valid request", async () => {
    const res = await post({
      scripture_refs: ["Salme 23"],
      _picks: [pick({ song: song({ id: "a" }), semantic_score: 0.5 })],
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as SermonResponse;
    expect(json.extract.scripture).toContain("Salme 23");
  });

  test("picks hydrate the full song without a leaked score", async () => {
    const res = await post({
      manuscript: MANUSCRIPT,
      _picks: [pick({ song: song({ id: "a" }), semantic_score: 0.5, key: "G" })],
    });
    const json = (await res.json()) as SermonResponse;
    const p = json.picks[0]!;
    expect(p.song.id).toBe("a");
    expect(p.song).not.toHaveProperty("score");
    expect(p.suggested_key).toBe("G");
    expect(typeof p.reason).toBe("string");
  });
});

describe("POST /v1/recommend/from-sermon — coverage overlay", () => {
  const profile = {
    church_id: "00000000-0000-0000-0000-000000000000",
    ccli_license_number: "12345",
    ccli_streaming_addon: false,
    tono_license_status: "state_church_blanket" as const,
    tono_streaming_addon: false,
    denomination: "den_norske_kirke" as const,
  };

  test("no profile → no coverage pill on picks", async () => {
    const res = await post({
      manuscript: MANUSCRIPT,
      _picks: [pick({ song: song({ id: "a" }), semantic_score: 0.5 })],
    });
    const json = (await res.json()) as SermonResponse;
    expect(json.picks[0]!.coverage).toBeUndefined();
  });

  test("with profile → each pick carries a CCLI/TONO coverage pill", async () => {
    const res = await post({
      manuscript: MANUSCRIPT,
      profile,
      _picks: [
        pick({ song: song({ id: "pd", copyright_status: "public_domain" }), semantic_score: 0.6 }),
        pick({ song: song({ id: "cc", copyright_status: "copyrighted", ccli_song_id: "777" }), semantic_score: 0.5 }),
      ],
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as SermonResponse;

    const byId = new Map(json.picks.map((p) => [p.song.id, p]));
    // PD song needs no CCLI; blanket TONO covers nothing PD.
    expect(byId.get("pd")!.coverage!.ccli_status).toBe("not_required");
    // Copyrighted song with a CCLI number + blanket TONO → covered both ways.
    expect(byId.get("cc")!.coverage!.ccli_status).toBe("covered");
    expect(byId.get("cc")!.coverage!.tono_status).toBe("covered");
    expect(byId.get("cc")!.coverage!.song_id).toBe("cc");
  });
});
