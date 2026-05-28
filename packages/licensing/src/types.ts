/**
 * Church licensing profile + coverage types.
 *
 * Norwegian churches navigate two systems at once: CCLI (projection/printing
 * rights, international) and TONO (public-performance rights, Norwegian
 * collective). The profile captures both, plus the streaming add-ons that
 * matter because streamed performances fall in a separate royalty pool.
 */

/** CCLI subscription size bands. */
export type CcliSizeCategory = "A" | "B" | "C" | "D" | "E" | "F";

/**
 * How the church relates to TONO.
 *  - state_church_blanket: Den norske kirke — most use covered by a blanket.
 *  - direct_agreement: frikirke/pinse/baptist with their own TONO arrangement.
 *  - application_pending: applied, not yet confirmed.
 *  - not_applicable / none: no TONO obligation / no license at all.
 */
export type TonoLicenseStatus =
  | "none"
  | "state_church_blanket"
  | "direct_agreement"
  | "application_pending"
  | "not_applicable";

export type Denomination =
  | "den_norske_kirke"
  | "frikirke"
  | "pinse"
  | "baptist"
  | "metodist"
  | "other";

export interface ChurchLicensingProfile {
  church_id: string;
  ccli_license_number?: string | null;
  ccli_size_category?: CcliSizeCategory | null;
  ccli_streaming_addon: boolean;
  tono_license_status: TonoLicenseStatus;
  tono_customer_id?: string | null;
  tono_streaming_addon: boolean;
  denomination: Denomination;
}

/**
 * Per-licensor coverage outcome.
 *  - not_required: public domain — no license needed.
 *  - foreign_reciprocal: covered through TONO's reciprocal deals with
 *    sister societies (ASCAP/PRS/GEMA...), but the church must still report.
 */
export type CoverageStatus =
  | "covered"
  | "not_covered"
  | "unknown"
  | "not_required"
  | "foreign_reciprocal";

export interface SongCoverage {
  song_id: string;
  ccli_status: CoverageStatus;
  tono_status: CoverageStatus;
  /** Human-readable edge cases worth surfacing to the admin. */
  gray_areas: string[];
}
