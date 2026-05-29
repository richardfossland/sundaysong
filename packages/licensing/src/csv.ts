/**
 * CSV serialization of licensing reports (Phase 7.2).
 *
 * CCLI accepts a simple song/number/date/count sheet. TONO (Norwegian) expects
 * verksnummer, brukstype and a separation of streamed vs in-room performances —
 * with Norwegian-language headers, since that's who reads it. Both are derived
 * from the same `LicensingReport`, so the two licensors never drift apart.
 */

import type { LicensingReport } from "@sundaysong/shared";

/** RFC-4180-ish quoting: wrap in quotes and double any inner quote. */
function cell(v: string | number | boolean): string {
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv(headers: string[], rows: Array<Array<string | number | boolean>>): string {
  const lines = [headers.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))];
  return lines.join("\r\n") + "\r\n";
}

/** CCLI reporting sheet — English headers, one row per logged song. */
export function ccliReportCsv(report: LicensingReport): string {
  return toCsv(
    ["Song Title", "CCLI Song Number", "Date of Use", "Use Count"],
    report.ccli_rows.map((r) => [r.song_title, r.ccli_song_id, r.service_date, r.use_count]),
  );
}

/** TONO-rapport — norske kolonner, skiller strømming fra fremføring i rom. */
export function tonoReportCsv(report: LicensingReport): string {
  return toCsv(
    ["Tittel", "Verksnummer", "Datoer", "Fremføringer (rom)", "Strømminger", "Dekket av blankettavtale"],
    report.tono_rows.map((r) => [
      r.song_title,
      r.tono_work_id,
      r.dates.join("; "),
      r.in_room_count,
      r.streamed_count,
      r.covered_by_blanket ? "ja" : "nei",
    ]),
  );
}

export type LicensingSystem = "ccli" | "tono";

/** Serialize either system from one report. */
export function reportCsv(report: LicensingReport, system: LicensingSystem): string {
  return system === "ccli" ? ccliReportCsv(report) : tonoReportCsv(report);
}
