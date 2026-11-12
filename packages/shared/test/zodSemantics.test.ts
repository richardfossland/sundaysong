/**
 * Pins the Zod schema behaviours that changed meaning between Zod 3 and 4
 * (defaults, coercion, uuid strictness, loose objects, refine messages), so a
 * future bump cannot silently alter the API's wire contract.
 */
import { describe, expect, test } from "bun:test";
import {
  CoverageInputSchema,
  LicensingReportInputSchema,
  RecommendSeasonInputSchema,
  SongSearchQuerySchema,
  SongUploadInputSchema,
  TransposeInputSchema,
  UsageEvent,
  RecommendRouteSchema,
} from "../src/index";

describe("zod semantics (v3 parity)", () => {
  test("defaults apply when fields are omitted", () => {
    const r = SongSearchQuerySchema.parse({ q: "grace" });
    expect(r.page).toBe(0);
    expect(r.page_size).toBe(20);
    expect(RecommendSeasonInputSchema.parse({ season: "Advent" }).limit).toBe(5);
    const t = TransposeInputSchema.parse({ chords: ["C"], from_key: "C", semitones: 2 });
    expect(t.dialect).toBe("international");
    expect(t.nashville).toBe(false);
    expect(UsageEvent.parse({
      church_id: "00000000-0000-0000-0000-000000000001",
      song_id: "00000000-0000-0000-0000-000000000002",
      variant_id: null,
      service_date: "2026-01-04",
      duration_displayed_sec: null,
      was_streamed: false,
      idempotency_key: "svc-1:item-2",
    }).schema_version).toBe(1);
  });

  test("optional numeric query fields stay undefined, strings are coerced", () => {
    const r = SongSearchQuerySchema.parse({ q: "x", bpm_min: "90", page: "2" });
    expect(r.bpm_min).toBe(90);
    expect(r.bpm_max).toBeUndefined();
    expect(r.page).toBe(2);
  });

  test("ids keep v3 leniency: non-RFC-9562 UUIDs are accepted, garbage is not", () => {
    const ok = LicensingReportInputSchema.safeParse({
      church_id: "11111111-2222-3333-4444-555555555555",
      from: "2026-01-01",
      to: "2026-01-31",
    });
    expect(ok.success).toBe(true);
    const bad = LicensingReportInputSchema.safeParse({ church_id: "nope", from: "2026-01-01", to: "2026-01-31" });
    expect(bad.success).toBe(false);
  });

  test("url fields: valid accepted, non-url rejected, null allowed", () => {
    const base = { title: "T", language: "en", license_declaration: true as const };
    expect(SongUploadInputSchema.safeParse({ ...base, lyrics_url: "https://example.com/a" }).success).toBe(true);
    expect(SongUploadInputSchema.safeParse({ ...base, lyrics_url: null }).success).toBe(true);
    expect(SongUploadInputSchema.safeParse({ ...base, lyrics_url: "not a url" }).success).toBe(false);
    expect(SongUploadInputSchema.parse(base).copyright_status).toBe("unknown");
  });

  test("loose objects keep unknown keys (v3 passthrough)", () => {
    const r = RecommendRouteSchema.parse({ _picks: [{ song: { id: "a", title: "kept" } }] });
    expect((r._picks![0]!.song as Record<string, unknown>).title).toBe("kept");
    expect(r._picks![0]!.semantic_score).toBe(0);
    const c = CoverageInputSchema.parse({
      song: { id: "a", canonical_title: "t", copyright_status: "unknown", nordic_metadata: { extra: 1 } },
      profile: {
        church_id: "c", ccli_streaming_addon: false, tono_license_status: "none",
        tono_streaming_addon: false, denomination: "other",
      },
    });
    expect((c.song.nordic_metadata as Record<string, unknown>).extra).toBe(1);
    expect(c.song.ccli_song_id).toBeNull();
    expect(c.song.tono_registered).toBe(false);
  });

  test("refine messages and paths are preserved", () => {
    const r = TransposeInputSchema.safeParse({ chords: ["C"], from_key: "C" });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toBe("provide either to_key or semitones");
    const p = SongSearchQuerySchema.safeParse({ q: "g", page: "1000", page_size: "100" });
    expect(p.error!.issues[0]!.path).toEqual(["page"]);
  });
});
