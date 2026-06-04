/**
 * Pure, framework-free logic for the /recommendations/set page (use case E —
 * "build me a whole service"). Kept out of the React component so it can be
 * unit-tested under `bun test` without a DOM, the same discipline the other
 * recommendation libs use.
 */

import type { RecommendSetInput, RecommendSetOutput } from "@sundaysong/sdk";

export type SetArc = NonNullable<RecommendSetInput["arc"]>;

export const SET_ARCS: Array<{ value: SetArc; label: string }> = [
  { value: "rising", label: "Rising" },
  { value: "reflective", label: "Reflective" },
  { value: "celebration", label: "Celebration" },
  { value: "lament", label: "Lament" },
  { value: "peak", label: "Peak" },
];

/** Raw, all-string form state — what the controlled inputs hold. */
export interface SetFormState {
  theme: string;
  scripture: string;
  description: string;
  arc: "" | SetArc;
  /** "size" packs to a song count; "duration" packs to a running time. */
  sizeMode: "size" | "duration";
  targetSize: string;
  targetDurationMin: string;
  maxBpmJump: string;
  /** Major-key share as a 0..100 string; "" means don't balance mode. */
  majorPct: string;
}

export const EMPTY_SET_FORM: SetFormState = {
  theme: "",
  scripture: "",
  description: "",
  arc: "rising",
  sizeMode: "size",
  targetSize: "5",
  targetDurationMin: "20",
  maxBpmJump: "",
  majorPct: "",
};

/**
 * Validate the set-builder form and project it onto a `RecommendSetInput`.
 *
 * Rules:
 *  - at least one intent field (theme / scripture / description) is required;
 *  - the active size/duration target must be a positive integer;
 *  - max BPM jump, when given, must be a positive number;
 *  - major %, when given, must be 0..100.
 * Empty optionals are dropped so we never send "" to the API.
 */
export function validateSetForm(
  form: SetFormState,
): { ok: true; input: RecommendSetInput } | { ok: false; error: string } {
  const theme = form.theme.trim();
  const scripture = form.scripture.trim();
  const description = form.description.trim();

  if (!theme && !scripture && !description) {
    return {
      ok: false,
      error: "Give the composer something to anchor on — a theme, scripture or description.",
    };
  }

  const input: RecommendSetInput = {};
  if (theme) input.theme = theme;
  if (scripture) input.scripture = scripture;
  if (description) input.description = description;
  if (form.arc) input.arc = form.arc;

  if (form.sizeMode === "size") {
    const n = Number(form.targetSize.trim());
    if (!Number.isInteger(n) || n <= 0) {
      return { ok: false, error: "Number of songs must be a positive whole number." };
    }
    input.target_size = n;
  } else {
    const m = Number(form.targetDurationMin.trim());
    if (!Number.isInteger(m) || m <= 0) {
      return { ok: false, error: "Target duration must be a positive number of minutes." };
    }
    input.target_duration_min = m;
  }

  const constraints: NonNullable<RecommendSetInput["constraints"]> = {};
  const jumpRaw = form.maxBpmJump.trim();
  if (jumpRaw) {
    const jump = Number(jumpRaw);
    if (!Number.isFinite(jump) || jump <= 0) {
      return { ok: false, error: "Max tempo jump must be a positive number of BPM." };
    }
    constraints.max_bpm_jump = jump;
  }
  const pctRaw = form.majorPct.trim();
  if (pctRaw) {
    const pct = Number(pctRaw);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return { ok: false, error: "Major-key share must be between 0 and 100." };
    }
    constraints.major_ratio = pct / 100;
  }
  if (Object.keys(constraints).length > 0) input.constraints = constraints;

  return { ok: true, input };
}

/** "23 min" / "1 h 5 min" from a minutes estimate. */
export function formatSetDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** The ordered key path through the set (nulls skipped). */
export function setKeyFlow(out: RecommendSetOutput): string[] {
  return out.trajectory.keys.filter((k): k is string => Boolean(k));
}

/** A one-line headline, e.g. "Rising · 5 songs · 20 min · 60% major". */
export function setSummaryLine(out: RecommendSetOutput): string {
  const count = out.slots.length;
  const songs = `${count} ${count === 1 ? "song" : "songs"}`;
  const dur = formatSetDuration(out.total_minutes_estimate);
  const label = out.arc ? SET_ARCS.find((a) => a.value === out.arc)?.label : undefined;
  const parts = [label, songs, dur].filter(Boolean) as string[];
  if (out.major_ratio !== null) parts.push(`${Math.round(out.major_ratio * 100)}% major`);
  return parts.join(" · ");
}

/** A 0..1 energy value mapped to a label for the trajectory display. */
export function energyLabel(v: number): string {
  return v >= 0.66 ? "high" : v >= 0.4 ? "mid" : "low";
}
