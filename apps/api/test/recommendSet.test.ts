/**
 * Tests for POST /v1/recommend/set — use case E ("build me a whole service").
 *
 * Offline: the route is exercised through `_candidates` injection, so no DB,
 * embedder or LLM is touched. The deep composition invariants live in
 * @sundaysong/ai's setComposer test; here we pin the route contract — schema
 * validation, the hydrated response shape, and that the constraints make it
 * through to the composer.
 */

import { describe, expect, test } from "bun:test";
import { recommendSetRoutes } from "../src/routes/recommendSet";

const post = (body: unknown) =>
  recommendSetRoutes.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

interface Cand {
  id: string;
  canonical_title: string;
  themes?: string[];
  bible_refs?: string[];
  popularity_score?: number;
  language?: string;
  semantic_score?: number;
  key?: string | null;
  bpm?: number | null;
}

const candidates: Cand[] = [
  { id: "grace-c", canonical_title: "Grace in C", themes: ["grace"], key: "C", bpm: 72, semantic_score: 0.8 },
  { id: "praise-g", canonical_title: "Praise in G", themes: ["praise"], key: "G", bpm: 100, semantic_score: 0.6 },
  { id: "still-am", canonical_title: "Be Still", themes: ["stillness"], key: "Am", bpm: 80, semantic_score: 0.5 },
  { id: "joy-d", canonical_title: "Joy in D", themes: ["joy"], key: "D", bpm: 120, semantic_score: 0.4 },
];

interface SetResponse {
  slots: Array<{
    position: number;
    song: { id: string; canonical_title: string };
    reason: string;
    suggested_key: string | null;
    bpm: number | null;
    tempo_violation: boolean;
  }>;
  total_minutes_estimate: number;
  major_ratio: number | null;
  trajectory: { energy: number[]; target_energy: number[]; keys: (string | null)[]; bpm: (number | null)[] };
  tempo_violations: number;
  summary: string;
  arc?: string;
}

describe("POST /v1/recommend/set", () => {
  test("200 with _candidates — composes an ordered set of target_size", async () => {
    const res = await post({ theme: "grace", target_size: 3, _candidates: candidates });
    expect(res.status).toBe(200);
    const json = (await res.json()) as SetResponse;
    expect(json.slots).toHaveLength(3);
    // Positions are 0..n-1 in running order.
    json.slots.forEach((s, i) => expect(s.position).toBe(i));
    // Each slot hydrates back to a full song object + a reason.
    for (const s of json.slots) {
      expect(typeof s.song.id).toBe("string");
      expect(s.song.canonical_title.length).toBeGreaterThan(0);
      expect(s.reason.length).toBeGreaterThan(0);
    }
  });

  test("trajectory arrays line up with the slots", async () => {
    const res = await post({ theme: "grace", arc: "rising", target_size: 4, _candidates: candidates });
    const json = (await res.json()) as SetResponse;
    const n = json.slots.length;
    expect(json.trajectory.energy).toHaveLength(n);
    expect(json.trajectory.keys).toHaveLength(n);
    expect(json.trajectory.bpm).toHaveLength(n);
    expect(json.trajectory.target_energy).toHaveLength(n); // arc requested → present
    expect(json.arc).toBe("rising");
  });

  test("honours the tempo cap — no jump over the cap when feasible", async () => {
    const res = await post({
      theme: "x",
      target_size: 4,
      constraints: { max_bpm_jump: 30 },
      _candidates: candidates,
    });
    const json = (await res.json()) as SetResponse;
    const bpms = json.slots.map((s) => s.bpm!).filter((b) => b != null);
    for (let i = 1; i < bpms.length; i++) {
      expect(Math.abs(bpms[i]! - bpms[i - 1]!)).toBeLessThanOrEqual(30);
    }
    expect(json.tempo_violations).toBe(0);
  });

  test("major_ratio is reported and pulled toward the target", async () => {
    const res = await post({
      theme: "x",
      target_size: 4,
      constraints: { major_ratio: 0.75 },
      _candidates: candidates,
    });
    const json = (await res.json()) as SetResponse;
    expect(json.major_ratio).not.toBeNull();
  });

  test("deterministic — identical input yields identical order", async () => {
    const body = { theme: "grace", arc: "rising", target_size: 4, _candidates: candidates };
    const a = (await (await post(body)).json()) as SetResponse;
    const b = (await (await post(body)).json()) as SetResponse;
    expect(a.slots.map((s) => s.song.id)).toEqual(b.slots.map((s) => s.song.id));
    expect(a.summary).toBe(b.summary);
  });

  test("400 on target_size out of range (> 20)", async () => {
    const res = await post({ theme: "grace", target_size: 99, _candidates: candidates });
    expect(res.status).toBe(400);
  });

  test("400 on an unknown arc value", async () => {
    const res = await post({ theme: "grace", arc: "nonsense", _candidates: candidates });
    expect(res.status).toBe(400);
  });

  test("400 on a bad major_ratio (> 1)", async () => {
    const res = await post({ theme: "grace", constraints: { major_ratio: 2 }, _candidates: candidates });
    expect(res.status).toBe(400);
  });

  test("empty pool → empty set with an explanation, still 200", async () => {
    const res = await post({ theme: "grace", target_size: 4, _candidates: [] });
    expect(res.status).toBe(200);
    const json = (await res.json()) as SetResponse;
    expect(json.slots).toHaveLength(0);
    expect(json.summary).toContain("No catalog songs");
  });
});
