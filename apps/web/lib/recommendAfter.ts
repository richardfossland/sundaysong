/**
 * Pure, framework-free logic for the /recommendations/after page.
 *
 * Kept out of the React component so it can be unit-tested under `bun test`
 * with no DOM, API or network — the same offline-first discipline the rest of
 * the web app and the API routes follow. The component imports `validateAfter`
 * and the formatting helpers; the tests exercise them against fixture
 * `RecommendAfterOutput` payloads.
 */

import type { RecommendAfterInput, RecommendAfterOutput } from "@sundaysong/sdk";

/** Raw, all-string form state — what the controlled inputs hold. */
export interface AfterFormState {
  songId: string;
  limit: string;
}

export const EMPTY_AFTER_FORM: AfterFormState = {
  songId: "",
  limit: "",
};

/**
 * Validate the form and, on success, project it onto a `RecommendAfterInput`.
 *
 * Rules:
 *  - A song id is required — the engine flows on FROM a specific song.
 *  - Limit, when given, must be a whole number between 1 and 20 (the route cap).
 * The empty limit is dropped so we never send `""` to the API.
 */
export function validateAfter(
  form: AfterFormState,
): { ok: true; input: RecommendAfterInput } | { ok: false; error: string } {
  const songId = form.songId.trim();
  if (!songId) {
    return { ok: false, error: "Enter the id of the song you want to flow on from." };
  }

  const input: RecommendAfterInput = { songId };

  const limRaw = form.limit.trim();
  if (limRaw) {
    const lim = Number(limRaw);
    if (!Number.isInteger(lim) || lim < 1 || lim > 20) {
      return { ok: false, error: "Limit must be a whole number between 1 and 20." };
    }
    input.limit = lim;
  }

  return { ok: true, input };
}

/**
 * The ordered list of suggested keys for the flow, starting from the from-song's
 * key (when known) and then each pick's suggested key. Picks without a suggested
 * key are skipped.
 */
export function afterKeyFlow(out: RecommendAfterOutput): string[] {
  const keys: string[] = [];
  if (out.from_key) keys.push(out.from_key);
  for (const p of out.picks) {
    if (p.suggested_key) keys.push(p.suggested_key);
  }
  return keys;
}

/** A one-line summary, e.g. "From G · 5 songs · key-flow" / "3 songs · BPM-only". */
export function afterSummary(out: RecommendAfterOutput): string {
  const count = out.picks.length;
  const songs = `${count} ${count === 1 ? "song" : "songs"}`;
  const from = out.from_key ? `From ${out.from_key}` : "Key unknown";
  const mode = out.key_flow ? "key-flow" : "BPM-only";
  return `${from} · ${songs} · ${mode}`;
}
