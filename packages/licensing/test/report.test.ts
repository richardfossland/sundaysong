import { describe, expect, test } from "bun:test";
import { buildLicensingReport } from "../src/report";
import { makeSong, makeUsage, frikirkeProfile, stateChurchProfile } from "./fixtures";

const PERIOD = { from: "2026-04-01", to: "2026-06-30" };

describe("buildLicensingReport — scoping + dedup", () => {
  test("filters to church + period, dedupes by idempotency key", () => {
    const song = makeSong({ copyright_status: "copyrighted", ccli_song_id: "100", tono_work_id: "T100", tono_registered: true });
    const usage = [
      makeUsage({ song_id: song.id, idempotency_key: "dup" }),
      makeUsage({ song_id: song.id, idempotency_key: "dup" }), // exact duplicate, ignored
      makeUsage({ song_id: song.id, church_id: "other-church", idempotency_key: "x" }), // wrong church
      makeUsage({ song_id: song.id, service_date: "2026-01-01", idempotency_key: "y" }), // out of period
    ];
    const r = buildLicensingReport({ profile: frikirkeProfile, songs: [song], usage, period: PERIOD });
    expect(r.ccli_rows.reduce((n, row) => n + row.use_count, 0)).toBe(1);
    expect(r.tono_rows[0]!.in_room_count).toBe(1);
  });

  test("two distinct uses of the same song on the same day count as two", () => {
    const song = makeSong({ copyright_status: "copyrighted", ccli_song_id: "100" });
    const usage = [
      makeUsage({ song_id: song.id, service_date: "2026-04-05", idempotency_key: "a" }),
      makeUsage({ song_id: song.id, service_date: "2026-04-05", idempotency_key: "b" }),
    ];
    const r = buildLicensingReport({ profile: frikirkeProfile, songs: [song], usage, period: PERIOD });
    expect(r.ccli_rows).toHaveLength(1);
    expect(r.ccli_rows[0]!.use_count).toBe(2);
  });
});

describe("buildLicensingReport — CCLI vs TONO routing", () => {
  test("public domain song appears in neither report and raises no warning", () => {
    const song = makeSong({ copyright_status: "public_domain" });
    const usage = [makeUsage({ song_id: song.id })];
    const r = buildLicensingReport({ profile: frikirkeProfile, songs: [song], usage, period: PERIOD });
    expect(r.ccli_rows).toHaveLength(0);
    expect(r.tono_rows).toHaveLength(0);
    expect(r.coverage_warnings).toHaveLength(0);
  });

  test("Norwegian hymn (no CCLI number, TONO-registered) → TONO only + CCLI warning", () => {
    const song = makeSong({
      canonical_title: "Navnet Jesus",
      copyright_status: "copyrighted",
      ccli_song_id: null,
      tono_work_id: "T-555",
      tono_registered: true,
    });
    const usage = [makeUsage({ song_id: song.id })];
    const r = buildLicensingReport({ profile: frikirkeProfile, songs: [song], usage, period: PERIOD });
    expect(r.ccli_rows).toHaveLength(0);
    expect(r.tono_rows).toHaveLength(1);
    expect(r.tono_rows[0]!.tono_work_id).toBe("T-555");
    expect(r.coverage_warnings.join(" ")).toContain("CCLI song number");
  });

  test("missing verksnummer raises a TONO warning but still lists the song", () => {
    const song = makeSong({ copyright_status: "copyrighted", ccli_song_id: "777", tono_work_id: null, tono_registered: false });
    const usage = [makeUsage({ song_id: song.id })];
    const r = buildLicensingReport({ profile: frikirkeProfile, songs: [song], usage, period: PERIOD });
    expect(r.tono_rows).toHaveLength(1);
    expect(r.tono_rows[0]!.tono_work_id).toBe("");
    expect(r.coverage_warnings.join(" ")).toContain("verksnummer");
  });
});

describe("buildLicensingReport — streamed vs in-room", () => {
  test("separates streamed and in-room counts and gathers all dates", () => {
    const song = makeSong({ copyright_status: "copyrighted", ccli_song_id: "100", tono_work_id: "T1", tono_registered: true });
    const usage = [
      makeUsage({ song_id: song.id, service_date: "2026-04-05", was_streamed: false, idempotency_key: "1" }),
      makeUsage({ song_id: song.id, service_date: "2026-04-12", was_streamed: true, idempotency_key: "2" }),
      makeUsage({ song_id: song.id, service_date: "2026-04-12", was_streamed: true, idempotency_key: "3" }),
    ];
    const r = buildLicensingReport({ profile: frikirkeProfile, songs: [song], usage, period: PERIOD });
    const row = r.tono_rows[0]!;
    expect(row.in_room_count).toBe(1);
    expect(row.streamed_count).toBe(2);
    expect(row.dates).toEqual(["2026-04-05", "2026-04-12"]);
  });

  test("streaming without a TONO streaming add-on warns", () => {
    const song = makeSong({ copyright_status: "copyrighted", ccli_song_id: "100", tono_work_id: "T1", tono_registered: true });
    const usage = [makeUsage({ song_id: song.id, was_streamed: true })];
    const profile = { ...frikirkeProfile, tono_streaming_addon: false };
    const r = buildLicensingReport({ profile, songs: [song], usage, period: PERIOD });
    expect(r.coverage_warnings.join(" ")).toContain("TONO streaming add-on");
  });
});

describe("buildLicensingReport — derivatives + blanket", () => {
  test("AI-translated variant is reported as the original work", () => {
    const original = makeSong({
      canonical_title: "How Great Is Our God",
      copyright_status: "copyrighted",
      ccli_song_id: "4348399",
      tono_work_id: "T-HGIOG",
      tono_registered: true,
    });
    const aiVariant = makeSong({ canonical_title: "Hvor stor du er (AI-utkast)", copyright_status: "copyrighted" });
    const usage = [makeUsage({ song_id: aiVariant.id })];
    const r = buildLicensingReport({
      profile: frikirkeProfile,
      songs: [original, aiVariant],
      usage,
      period: PERIOD,
      reportAs: { [aiVariant.id]: original.id },
    });
    expect(r.tono_rows).toHaveLength(1);
    expect(r.tono_rows[0]!.song_title).toBe("How Great Is Our God");
    expect(r.tono_rows[0]!.tono_work_id).toBe("T-HGIOG");
  });

  test("state-church blanket marks rows covered_by_blanket", () => {
    const song = makeSong({ copyright_status: "copyrighted", ccli_song_id: "100", tono_work_id: "T1", tono_registered: true });
    const usage = [makeUsage({ song_id: song.id })];
    const r = buildLicensingReport({ profile: stateChurchProfile, songs: [song], usage, period: PERIOD });
    expect(r.tono_rows[0]!.covered_by_blanket).toBe(true);
  });

  test("usage for an unknown song is skipped with a warning", () => {
    const usage = [makeUsage({ song_id: "ghost" })];
    const r = buildLicensingReport({ profile: frikirkeProfile, songs: [], usage, period: PERIOD });
    expect(r.ccli_rows).toHaveLength(0);
    expect(r.tono_rows).toHaveLength(0);
    expect(r.coverage_warnings.join(" ")).toContain("unknown song");
  });
});
