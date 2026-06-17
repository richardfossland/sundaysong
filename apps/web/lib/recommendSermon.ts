/**
 * Pure, framework-free logic for the Sermon-to-Setlist recommendation mode.
 *
 * Kept out of the React component so it can be unit-tested under `bun test`
 * without a DOM — the same discipline the other recommendation libs use. The
 * builder imports `validateSermonForm` + the coverage-pill helpers; the tests
 * exercise them directly against fixtures.
 */

import type { RecommendFromSermonInput, RecommendFromSermonOutput } from "@sundaysong/sdk";

/** Raw, all-string form state — what the controlled inputs hold. */
export interface SermonFormState {
  title: string;
  manuscript: string;
  /** Newline- or comma-separated scripture refs the leader already knows. */
  scriptureRefs: string;
  durationMin: string;
}

export const EMPTY_SERMON_FORM: SermonFormState = {
  title: "",
  manuscript: "",
  scriptureRefs: "",
  durationMin: "",
};

/** Split the free-text refs box into a clean, deduped list. */
export function parseRefsInput(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\n;,]+/)) {
    const s = part.trim();
    if (s && !seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase());
      out.push(s);
    }
  }
  return out;
}

/**
 * Validate the sermon form and project it onto a `RecommendFromSermonInput`.
 * At least a manuscript or one scripture ref is required; the duration cap,
 * when given, must be a positive integer. Empty optionals are dropped.
 */
export function validateSermonForm(
  form: SermonFormState,
): { ok: true; input: RecommendFromSermonInput } | { ok: false; error: string } {
  const manuscript = form.manuscript.trim();
  const refs = parseRefsInput(form.scriptureRefs);

  if (!manuscript && refs.length === 0) {
    return {
      ok: false,
      error: "Lim inn prekenmanuset eller skriv inn minst én bibelreferanse.",
    };
  }

  const input: RecommendFromSermonInput = {};
  if (form.title.trim()) input.title = form.title.trim();
  if (manuscript) input.manuscript = manuscript;
  if (refs.length > 0) input.scripture_refs = refs;

  const durRaw = form.durationMin.trim();
  if (durRaw) {
    const n = Number(durRaw);
    if (!Number.isInteger(n) || n <= 0) {
      return { ok: false, error: "Varighet må være et positivt antall minutter." };
    }
    input.duration_min = n;
  }

  return { ok: true, input };
}

export type CoverageStatus = NonNullable<RecommendFromSermonOutput["picks"][number]["coverage"]>["ccli_status"];

/** A short, human label + tone for a single licensor's coverage status. */
export function coverageStatusLabel(status: CoverageStatus): { text: string; tone: "ok" | "warn" | "no" | "na" } {
  switch (status) {
    case "covered":
      return { text: "dekket", tone: "ok" };
    case "not_required":
      return { text: "ikke nødvendig", tone: "na" };
    case "foreign_reciprocal":
      return { text: "via gjensidig avtale", tone: "warn" };
    case "not_covered":
      return { text: "ikke dekket", tone: "no" };
    case "unknown":
    default:
      return { text: "sjekk", tone: "warn" };
  }
}

/**
 * Collapse a pick's CCLI + TONO statuses into the single pill the UI shows.
 * Worst-case tone wins so a leader sees the thing that needs attention.
 */
export function coveragePill(
  coverage: NonNullable<RecommendFromSermonOutput["picks"][number]["coverage"]>,
): { text: string; tone: "ok" | "warn" | "no" } {
  const ccli = coverageStatusLabel(coverage.ccli_status);
  const tono = coverageStatusLabel(coverage.tono_status);
  const worst: "ok" | "warn" | "no" =
    ccli.tone === "no" || tono.tone === "no"
      ? "no"
      : ccli.tone === "warn" || tono.tone === "warn"
        ? "warn"
        : "ok";
  return { text: `CCLI: ${ccli.text} · TONO: ${tono.text}`, tone: worst };
}
