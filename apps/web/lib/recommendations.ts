/**
 * Pure, framework-free logic for the /recommendations page.
 *
 * Kept out of the React components so it can be unit-tested under `bun test`
 * without jsdom or a DOM renderer — the same offline-first discipline the API
 * package uses for its route tests. The components import `validateForm` and
 * the formatting helpers; the tests exercise them directly against fixture
 * `RecommendOutput` payloads.
 */

import type { RecommendInput, RecommendOutput } from "@sunday/song-sdk";

export type Arc = NonNullable<RecommendInput["arc"]>;

export const ARCS: Array<{ value: Arc; label: string }> = [
  { value: "rising", label: "Rising" },
  { value: "reflective", label: "Reflective" },
  { value: "celebration", label: "Celebration" },
  { value: "lament", label: "Lament" },
];

/** Raw, all-string form state — what the controlled inputs hold. */
export interface RecommendFormState {
  theme: string;
  scripture: string;
  description: string;
  arc: "" | Arc;
  afterSongId: string;
  durationMin: string;
}

export const EMPTY_FORM: RecommendFormState = {
  theme: "",
  scripture: "",
  description: "",
  arc: "",
  afterSongId: "",
  durationMin: "",
};

/**
 * Validate the form and, on success, project it onto a `RecommendInput`.
 *
 * Rules:
 *  - At least one intent field (theme / scripture / description / after-song)
 *    must be filled — the engine needs something to anchor on.
 *  - Duration, when given, must be a positive number of minutes.
 * Empty optional fields are dropped so we never send `""` to the API.
 */
export function validateForm(
  form: RecommendFormState,
): { ok: true; input: RecommendInput } | { ok: false; error: string } {
  const theme = form.theme.trim();
  const scripture = form.scripture.trim();
  const description = form.description.trim();
  const afterSongId = form.afterSongId.trim();

  if (!theme && !scripture && !description && !afterSongId) {
    return {
      ok: false,
      error: "Give the planner something to work with — a theme, scripture, description, or a song to follow.",
    };
  }

  const input: RecommendInput = {};
  if (theme) input.theme = theme;
  if (scripture) input.scripture = scripture;
  if (description) input.description = description;
  if (afterSongId) input.after_song_id = afterSongId;
  if (form.arc) input.arc = form.arc;

  const durRaw = form.durationMin.trim();
  if (durRaw) {
    const dur = Number(durRaw);
    if (!Number.isFinite(dur) || dur <= 0) {
      return { ok: false, error: "Duration must be a positive number of minutes." };
    }
    input.duration_min = dur;
  }

  return { ok: true, input };
}

/** "23 min" / "1 h 5 min" from a minutes estimate. */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/**
 * The ordered list of suggested keys across the set — the "key flow" of the
 * service. Picks without a suggested key are skipped.
 */
export function keyFlow(out: RecommendOutput): string[] {
  return out.picks.map((p) => p.suggested_key).filter((k): k is string => Boolean(k));
}

/** A one-line energy-arc summary, e.g. "Reflective → 4 songs · 23 min". */
export function arcSummary(out: RecommendOutput, arc: "" | Arc): string {
  const count = out.picks.length;
  const songs = `${count} ${count === 1 ? "song" : "songs"}`;
  const dur = formatDuration(out.total_minutes_estimate);
  const label = arc ? ARCS.find((a) => a.value === arc)?.label : undefined;
  return label ? `${label} · ${songs} · ${dur}` : `${songs} · ${dur}`;
}
