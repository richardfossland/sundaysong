/**
 * Per-song licensing coverage.
 *
 * Given a song's metadata and a church's licensing profile, decide whether the
 * song is covered for CCLI and for TONO, and surface the gray areas that need
 * a human's eye. This is the logic behind the "✓ CCLI + TONO" / "⚠ Check TONO"
 * pill that Stage and Plan show on every song.
 */

import type { Song } from "@sundaysong/shared";
import type { ChurchLicensingProfile, CoverageStatus, SongCoverage } from "./types";

/**
 * The subset of a song the coverage logic actually reads. A full `Song`
 * satisfies it, but callers (e.g. the coverage API endpoint) can also pass a
 * lighter object without fabricating the rest of the row.
 */
export type CoverageSongInput = Pick<
  Song,
  | "id"
  | "canonical_title"
  | "copyright_status"
  | "ccli_song_id"
  | "tono_work_id"
  | "tono_registered"
  | "nordic_metadata"
>;

/**
 * The copyright status that matters for TONO is the *Norwegian* one. A work
 * can be public domain in the US/UK (e.g. an old hymn whose composer died
 * within the last 70 years elsewhere) yet still protected under Norway's
 * life+70 rule. We trust the Norwegian override when present.
 */
function effectiveNorwegianCopyright(song: CoverageSongInput): Song["copyright_status"] {
  return song.nordic_metadata.copyright_status_no ?? song.copyright_status;
}

export function computeCoverage(song: CoverageSongInput, profile: ChurchLicensingProfile): SongCoverage {
  const gray: string[] = [];

  // ── CCLI ──────────────────────────────────────────────────────────────────
  let ccli_status: CoverageStatus;
  if (song.copyright_status === "public_domain") {
    ccli_status = "not_required";
  } else if (!profile.ccli_license_number) {
    ccli_status = "not_covered";
  } else if (song.ccli_song_id) {
    ccli_status = "covered";
  } else {
    ccli_status = "unknown";
    gray.push(
      `"${song.canonical_title}" is copyrighted but has no CCLI song number — ` +
        `verify it is in the CCLI catalog before reporting.`,
    );
  }

  // ── TONO ──────────────────────────────────────────────────────────────────
  const noCopyright = effectiveNorwegianCopyright(song);

  // The US-PD / NO-copyright divergence is a classic trap; surface it whenever
  // the work looks free abroad but is (or might be) protected in Norway.
  if (song.copyright_status === "public_domain" && noCopyright !== "public_domain") {
    gray.push(
      `"${song.canonical_title}" is public domain internationally but may be ` +
        `copyrighted in Norway (life+70 rule) — verify before treating as PD.`,
    );
  }

  let tono_status: CoverageStatus;
  if (noCopyright === "public_domain") {
    tono_status = "not_required";
  } else {
    switch (profile.tono_license_status) {
      case "not_applicable":
        tono_status = "not_required";
        break;
      case "none":
        tono_status = "not_covered";
        break;
      case "application_pending":
        tono_status = "unknown";
        gray.push(
          `TONO application pending — coverage for "${song.canonical_title}" not yet confirmed.`,
        );
        break;
      case "state_church_blanket":
        tono_status = "covered";
        break;
      case "direct_agreement":
        if (song.tono_registered) {
          tono_status = "covered";
        } else if (noCopyright === "copyrighted") {
          tono_status = "foreign_reciprocal";
          gray.push(
            `"${song.canonical_title}" is not registered with TONO — likely a foreign work ` +
              `covered via TONO's reciprocal agreements, but it must still be reported.`,
          );
        } else {
          tono_status = "unknown";
        }
        break;
    }
  }

  return { song_id: song.id, ccli_status, tono_status, gray_areas: gray };
}
