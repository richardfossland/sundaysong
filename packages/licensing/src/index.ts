/**
 * `@sundaysong/licensing` — pure CCLI + TONO coverage and reporting.
 *
 * The strategic moat: first-class TONO handling alongside CCLI for Norwegian
 * and Nordic churches. No DB, no I/O — feed it a church profile, song
 * metadata, and usage rows, and it computes per-song coverage and the two
 * licensors' reports from the same source of truth.
 */

export type {
  CcliSizeCategory,
  TonoLicenseStatus,
  Denomination,
  ChurchLicensingProfile,
  CoverageStatus,
  SongCoverage,
} from "./types";
export { type CoverageSongInput, computeCoverage } from "./coverage";
export { type BuildReportInput, buildLicensingReport } from "./report";
export { type LicensingSystem, ccliReportCsv, tonoReportCsv, reportCsv } from "./csv";
