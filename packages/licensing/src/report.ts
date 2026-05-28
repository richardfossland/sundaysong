/**
 * Licensing report generation — CCLI + TONO from one usage log.
 *
 * Both reports are derived from the same `usage_log` rows so they can never
 * drift apart. The hard parts are Norwegian-specific: separating in-room from
 * streamed performances (different TONO royalty pools), reporting the original
 * work for derivative/AI-translated variants, and flagging the songs that
 * silently fall outside a church's coverage.
 */

import type {
  Song,
  UsageLogRow,
  LicensingReport,
  CcliReportRow,
  TonoReportRow,
} from "@sundaysong/shared";
import type { ChurchLicensingProfile } from "./types";
import { computeCoverage } from "./coverage";

export interface BuildReportInput {
  profile: ChurchLicensingProfile;
  /** Catalog metadata for every song referenced by the usage rows. */
  songs: Song[];
  /** Raw usage rows; may span more churches/dates than the report period. */
  usage: UsageLogRow[];
  /** Inclusive reporting period, ISO `YYYY-MM-DD`. */
  period: { from: string; to: string };
  /**
   * Optional remap from a performed `song_id` to the canonical work to report.
   * Use for AI-translated / derivative variants — the underlying original work
   * is what carries the CCLI/TONO registration, so that is what gets reported.
   */
  reportAs?: Record<string, string>;
}

function requiresTono(song: Song): boolean {
  const no = song.nordic_metadata.copyright_status_no ?? song.copyright_status;
  return no !== "public_domain";
}

export function buildLicensingReport(input: BuildReportInput): LicensingReport {
  const { profile, period } = input;
  const songById = new Map(input.songs.map((s) => [s.id, s]));
  const canonicalId = (id: string) => input.reportAs?.[id] ?? id;
  const warnings: string[] = [];
  const warn = (m: string) => { if (!warnings.includes(m)) warnings.push(m); };

  // 1. Scope to this church + period, then dedupe by idempotency key.
  const seen = new Set<string>();
  const rows = input.usage.filter((r) => {
    if (r.church_id !== profile.church_id) return false;
    if (r.service_date < period.from || r.service_date > period.to) return false;
    if (seen.has(r.idempotency_key)) return false;
    seen.add(r.idempotency_key);
    return true;
  });

  // ── CCLI report: one row per (song, date) with a use count ──────────────────
  const ccliGroups = new Map<string, CcliReportRow>();
  // ── TONO accumulation: one entry per song over the whole period ─────────────
  interface TonoAcc {
    song: Song;
    dates: Set<string>;
    streamed: number;
    inRoom: number;
  }
  const tonoAcc = new Map<string, TonoAcc>();

  let anyStreamed = false;

  for (const row of rows) {
    const song = songById.get(canonicalId(row.song_id));
    if (!song) {
      warn(`Usage logged for unknown song_id ${canonicalId(row.song_id)} — not included in reports.`);
      continue;
    }
    if (row.was_streamed) anyStreamed = true;

    const coverage = computeCoverage(song, profile);
    for (const g of coverage.gray_areas) warn(g);

    // CCLI: copyrighted works only; PD needs no CCLI report.
    if (song.copyright_status !== "public_domain") {
      if (!profile.ccli_license_number) {
        warn(`"${song.canonical_title}" is copyrighted but the church has no CCLI license on file.`);
      } else if (!song.ccli_song_id) {
        warn(`"${song.canonical_title}" is copyrighted but has no CCLI song number — cannot be reported to CCLI.`);
      } else {
        const key = `${song.id}|${row.service_date}`;
        const existing = ccliGroups.get(key);
        if (existing) {
          existing.use_count += 1;
        } else {
          ccliGroups.set(key, {
            song_title: song.canonical_title,
            ccli_song_id: song.ccli_song_id,
            service_date: row.service_date,
            use_count: 1,
          });
        }
      }
    }

    // TONO: anything still under copyright in Norway must be reported.
    if (requiresTono(song)) {
      if (profile.tono_license_status === "none") {
        warn(`"${song.canonical_title}" requires TONO but the church has no TONO license.`);
      }
      let acc = tonoAcc.get(song.id);
      if (!acc) {
        acc = { song, dates: new Set(), streamed: 0, inRoom: 0 };
        tonoAcc.set(song.id, acc);
      }
      acc.dates.add(row.service_date);
      if (row.was_streamed) acc.streamed += 1; else acc.inRoom += 1;
      if (!song.tono_work_id) {
        warn(`"${song.canonical_title}" requires TONO reporting but has no verksnummer (TONO work ID).`);
      }
    }
  }

  const ccli_rows = [...ccliGroups.values()].sort(
    (a, b) => a.service_date.localeCompare(b.service_date) || a.song_title.localeCompare(b.song_title),
  );

  const coveredByBlanket = profile.tono_license_status === "state_church_blanket";
  const tono_rows: TonoReportRow[] = [...tonoAcc.values()]
    .map((a) => ({
      song_title: a.song.canonical_title,
      tono_work_id: a.song.tono_work_id ?? "",
      dates: [...a.dates].sort(),
      streamed_count: a.streamed,
      in_room_count: a.inRoom,
      covered_by_blanket: coveredByBlanket,
    }))
    .sort((a, b) => a.song_title.localeCompare(b.song_title));

  // Streaming add-on checks — streamed performances sit in a separate pool.
  if (anyStreamed && requiresTonoAny(tono_rows) && !profile.tono_streaming_addon) {
    warn("Streamed performances are logged but the church has no TONO streaming add-on.");
  }
  if (anyStreamed && ccli_rows.length > 0 && !profile.ccli_streaming_addon) {
    warn("Streamed performances are logged but the church has no CCLI streaming add-on.");
  }

  return {
    church_id: profile.church_id,
    period_from: period.from,
    period_to: period.to,
    ccli_rows,
    tono_rows,
    coverage_warnings: warnings,
  };
}

function requiresTonoAny(rows: TonoReportRow[]): boolean {
  return rows.some((r) => r.streamed_count > 0 || r.in_room_count > 0);
}
