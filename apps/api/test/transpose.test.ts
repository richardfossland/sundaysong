/**
 * Tests for the "instant transposition" feature — POST /v1/transpose.
 *
 * This is a core product promise ("AI features no one else has"). The route is
 * pure music theory — no DB, no embeddings, no network — so these run fully
 * offline. They assert the API contract: the chords[] and chordpro input paths,
 * key resolution (to_key vs semitones), both dialects (international/german),
 * the optional nashville/capo add-ons, the Zod schema validation, and the
 * invalid-key error shape.
 *
 * The underlying music functions are unit-tested in packages/music; these tests
 * cover the contract the route layer adds on top (request validation, response
 * shape, optional-feature wiring), not the theory itself.
 */

import { describe, expect, test } from "bun:test";

import { transposeRoutes } from "../src/routes/transpose";

// ── Helpers ───────────────────────────────────────────────────────────────────

const post = (body: unknown) =>
  transposeRoutes.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

interface TransposeResponse {
  from_key: string;
  to_key: string;
  semitones: number;
  chords?: string[];
  chordpro?: string;
  nashville?: Array<string | null>;
  capo?: Array<{ capo: number; playAs: string }>;
}

// ── 1. chords[] input path ─────────────────────────────────────────────────────

describe("POST /v1/transpose — chords path", () => {
  test("200 — C→D with explicit to_key", async () => {
    const res = await post({ chords: ["C", "F", "G", "Am"], from_key: "C", to_key: "D" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as TransposeResponse;
    expect(json.from_key).toBe("C");
    expect(json.to_key).toBe("D");
    expect(json.semitones).toBe(2);
    expect(json.chords).toEqual(["D", "G", "A", "Bm"]);
  });

  test("200 — semitones target resolves the landing key (C +2 → D)", async () => {
    const res = await post({ chords: ["C", "F", "G"], from_key: "C", semitones: 2 });
    expect(res.status).toBe(200);
    const json = (await res.json()) as TransposeResponse;
    expect(json.to_key).toBe("D");
    expect(json.semitones).toBe(2);
    expect(json.chords).toEqual(["D", "G", "A"]);
  });

  test("200 — negative semitones land below (C -2 → Bb, flat spelling)", async () => {
    const res = await post({ chords: ["C", "F", "G"], from_key: "C", semitones: -2 });
    const json = (await res.json()) as TransposeResponse;
    expect(json.to_key).toBe("Bb");
    expect(json.chords).toEqual(["Bb", "Eb", "F"]);
  });

  test("200 — same-key transposition is a no-op (semitones 0)", async () => {
    const res = await post({ chords: ["C", "F", "G"], from_key: "C", to_key: "C" });
    const json = (await res.json()) as TransposeResponse;
    expect(json.semitones).toBe(0);
    expect(json.chords).toEqual(["C", "F", "G"]);
  });

  test("200 — flat target keys spell with flats (C→Eb)", async () => {
    const res = await post({ chords: ["C", "F", "G"], from_key: "C", to_key: "Eb" });
    const json = (await res.json()) as TransposeResponse;
    expect(json.semitones).toBe(3);
    expect(json.chords).toEqual(["Eb", "Ab", "Bb"]);
  });

  test("200 — tritone transposition picks the short way (C→F#/Gb)", async () => {
    const res = await post({ chords: ["C", "F", "G"], from_key: "C", to_key: "F#" });
    const json = (await res.json()) as TransposeResponse;
    expect(json.semitones).toBe(6);
    expect(json.to_key).toBe("Gb"); // F# input, but the engine re-spells the landing key
    expect(json.chords).toEqual(["Gb", "B", "Db"]);
  });

  test("200 — preserves extensions and slash basses (C→E)", async () => {
    const res = await post({ chords: ["Cmaj7", "Dm7", "G7/B"], from_key: "C", to_key: "E" });
    const json = (await res.json()) as TransposeResponse;
    expect(json.chords).toEqual(["Emaj7", "F#m7", "B7/D#"]);
  });

  test("200 — minor source key is kept as minor in the landing key (Am +3 → Cm)", async () => {
    const res = await post({ chords: ["Am", "Dm", "E"], from_key: "Am", semitones: 3 });
    const json = (await res.json()) as TransposeResponse;
    expect(json.to_key).toBe("Cm");
  });

  test("200 — chords path never returns a chordpro field", async () => {
    const res = await post({ chords: ["C"], from_key: "C", to_key: "D" });
    const json = (await res.json()) as TransposeResponse;
    expect(json.chordpro).toBeUndefined();
    expect(Array.isArray(json.chords)).toBe(true);
  });
});

// ── 2. chordpro input path ──────────────────────────────────────────────────────

describe("POST /v1/transpose — chordpro path", () => {
  test("200 — transposes only bracketed chords, leaves lyrics intact", async () => {
    const res = await post({ chordpro: "[C]Amazing [F]grace", from_key: "C", to_key: "D" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as TransposeResponse;
    expect(json.from_key).toBe("C");
    expect(json.to_key).toBe("D");
    expect(json.semitones).toBe(2);
    expect(json.chordpro).toBe("[D]Amazing [G]grace");
  });

  test("200 — non-chord tokens pass through verbatim ([x2])", async () => {
    const res = await post({ chordpro: "[C]Amazing [F]grace [x2]", from_key: "C", to_key: "D" });
    const json = (await res.json()) as TransposeResponse;
    expect(json.chordpro).toBe("[D]Amazing [G]grace [x2]");
  });

  test("200 — semitones target works for chordpro too", async () => {
    const res = await post({ chordpro: "[C]Hello", from_key: "C", semitones: -2 });
    const json = (await res.json()) as TransposeResponse;
    expect(json.to_key).toBe("Bb");
    expect(json.chordpro).toBe("[Bb]Hello");
  });

  test("200 — chordpro path never returns a chords field", async () => {
    const res = await post({ chordpro: "[C]Hi", from_key: "C", to_key: "D" });
    const json = (await res.json()) as TransposeResponse;
    expect(json.chords).toBeUndefined();
    expect(typeof json.chordpro).toBe("string");
  });
});

// ── 3. Nashville add-on ─────────────────────────────────────────────────────────

describe("POST /v1/transpose — nashville", () => {
  test("200 — chords path emits Nashville numbers relative to the source key", async () => {
    const res = await post({ chords: ["C", "F", "G", "Am"], from_key: "C", to_key: "D", nashville: true });
    const json = (await res.json()) as TransposeResponse;
    // Numbers are computed in the FROM key (C), not the target.
    expect(json.nashville).toEqual(["1", "4", "5", "6m"]);
  });

  test("200 — chordpro path emits Nashville for extracted chords, null for non-chords", async () => {
    const res = await post({ chordpro: "[C]a [F]b [x2]", from_key: "C", to_key: "D", nashville: true });
    const json = (await res.json()) as TransposeResponse;
    expect(json.nashville).toEqual(["1", "4", null]);
  });

  test("200 — nashville omitted by default", async () => {
    const res = await post({ chords: ["C"], from_key: "C", to_key: "D" });
    const json = (await res.json()) as TransposeResponse;
    expect(json.nashville).toBeUndefined();
  });

  test("200 — nashville: false also omits the field", async () => {
    const res = await post({ chords: ["C"], from_key: "C", to_key: "D", nashville: false });
    const json = (await res.json()) as TransposeResponse;
    expect(json.nashville).toBeUndefined();
  });
});

// ── 4. Capo add-on ──────────────────────────────────────────────────────────────

describe("POST /v1/transpose — capo", () => {
  test("200 — suggests capo positions for the landing key (Eb)", async () => {
    const res = await post({ chords: ["C"], from_key: "C", to_key: "Eb", capo: true });
    const json = (await res.json()) as TransposeResponse;
    expect(Array.isArray(json.capo)).toBe(true);
    expect(json.capo!.length).toBeGreaterThan(0);
    // Best (lowest) suggestion first: capo 1, play D shapes.
    expect(json.capo![0]).toEqual({ capo: 1, playAs: "D" });
    for (const s of json.capo!) {
      expect(typeof s.capo).toBe("number");
      expect(typeof s.playAs).toBe("string");
    }
  });

  test("200 — capo suggestions are keyed to the resolved target, not the source", async () => {
    // Land in Eb via semitones; capo list should match Eb.
    const res = await post({ chords: ["C"], from_key: "C", semitones: 3, capo: true });
    const json = (await res.json()) as TransposeResponse;
    expect(json.to_key).toBe("Eb");
    expect(json.capo![0]).toEqual({ capo: 1, playAs: "D" });
  });

  test("200 — capo omitted by default", async () => {
    const res = await post({ chords: ["C"], from_key: "C", to_key: "Eb" });
    const json = (await res.json()) as TransposeResponse;
    expect(json.capo).toBeUndefined();
  });

  test("200 — nashville and capo can be requested together", async () => {
    const res = await post({
      chords: ["C", "G"],
      from_key: "C",
      to_key: "Eb",
      nashville: true,
      capo: true,
    });
    const json = (await res.json()) as TransposeResponse;
    expect(json.nashville).toEqual(["1", "5"]);
    expect(Array.isArray(json.capo)).toBe(true);
  });
});

// ── 5. German / Nordic dialect ──────────────────────────────────────────────────

describe("POST /v1/transpose — german dialect", () => {
  test("200 — understands H and renders the landing key back as H", async () => {
    const res = await post({ chords: ["A", "H", "Cis"], from_key: "A", to_key: "H", dialect: "german" });
    const json = (await res.json()) as TransposeResponse;
    expect(json.to_key).toBe("H");
    expect(json.semitones).toBe(2);
    expect(json.chords).toEqual(["H", "C#", "D#"]);
  });

  test("200 — H parses as a key only in the german dialect (400 in international)", async () => {
    const res = await post({ chords: ["H"], from_key: "H", to_key: "C" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_key");
  });

  test("200 — semitones key resolution respects the dialect", async () => {
    const res = await post({ chords: ["A"], from_key: "A", semitones: 2, dialect: "german" });
    const json = (await res.json()) as TransposeResponse;
    expect(json.to_key).toBe("H");
  });
});

// ── 6. Invalid keys → 400 invalid_key ────────────────────────────────────────────

describe("POST /v1/transpose — invalid keys", () => {
  test("400 — invalid to_key", async () => {
    const res = await post({ chords: ["C"], from_key: "C", to_key: "Q" });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; message: string };
    expect(json.error).toBe("invalid_key");
    expect(typeof json.message).toBe("string");
  });

  test("400 — invalid from_key with semitones target", async () => {
    const res = await post({ chords: ["C"], from_key: "Q", semitones: 2 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_key");
  });

  test("400 — invalid from_key on the chordpro path", async () => {
    const res = await post({ chordpro: "[C]Hi", from_key: "Q", to_key: "D" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_key");
  });
});

// ── 7. Schema validation → 400 ───────────────────────────────────────────────────

describe("POST /v1/transpose — schema validation", () => {
  test("400 — neither to_key nor semitones provided", async () => {
    const res = await post({ chords: ["C"], from_key: "C" });
    expect(res.status).toBe(400);
  });

  test("400 — both chords and chordpro provided (must be exactly one)", async () => {
    const res = await post({ chords: ["C"], chordpro: "[C]Hi", from_key: "C", to_key: "D" });
    expect(res.status).toBe(400);
  });

  test("400 — neither chords nor chordpro provided", async () => {
    const res = await post({ from_key: "C", to_key: "D" });
    expect(res.status).toBe(400);
  });

  test("400 — missing from_key", async () => {
    const res = await post({ chords: ["C"], to_key: "D" });
    expect(res.status).toBe(400);
  });

  test("400 — semitones out of the -11..11 range", async () => {
    const res = await post({ chords: ["C"], from_key: "C", semitones: 12 });
    expect(res.status).toBe(400);
  });

  test("400 — semitones not an integer", async () => {
    const res = await post({ chords: ["C"], from_key: "C", semitones: 2.5 });
    expect(res.status).toBe(400);
  });

  test("400 — unknown dialect", async () => {
    const res = await post({ chords: ["C"], from_key: "C", to_key: "D", dialect: "klingon" });
    expect(res.status).toBe(400);
  });

  test("400 — empty chord token (below the 1-char minimum)", async () => {
    const res = await post({ chords: [""], from_key: "C", to_key: "D" });
    expect(res.status).toBe(400);
  });
});
