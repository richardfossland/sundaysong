/**
 * Pure, framework-free logic for the /songs search filter controls.
 *
 * The search route + SDK `songs.search()` accept variant-level musical filters
 * (language, themes, bpm_min, bpm_max, key) which the Postgres fallback applies
 * inside its SQL window. This module owns the param <-> URL <-> SDK projection
 * for those controls so the React page stays declarative and the tricky bits
 * (range validation, key list, URL round-tripping alongside the existing facet
 * params) are unit-tested under `bun test` with no DOM, API or network — the
 * same offline-first discipline as `searchFacets.ts`.
 *
 * It deliberately mirrors the route's `SongSearchQuerySchema` bounds (bpm
 * 20..300, themes max 8) so the UI never sends a request the API would 400.
 */

import { keyToString, parseKey, type Key } from "@sundaysong/music";
import type { SearchParams } from "@sundaysong/sdk";

/** Raw, all-string form state — what the controlled inputs hold. */
export interface SearchFilterState {
  /** ISO-ish language code, e.g. "no", "en". Empty = any. */
  language: string;
  /** A single theme to AND into the query. Empty = none. */
  theme: string;
  /** Tempo floor as a string (so an empty input is representable). */
  bpmMin: string;
  /** Tempo ceiling as a string. */
  bpmMax: string;
  /** Key name, e.g. "C", "Am". Empty = any. */
  key: string;
}

export const EMPTY_FILTERS: SearchFilterState = {
  language: "",
  theme: "",
  bpmMin: "",
  bpmMax: "",
  key: "",
};

/** Route schema bounds — kept in lockstep with `SongSearchQuerySchema`. */
export const BPM_MIN = 20;
export const BPM_MAX = 300;

/**
 * The canonical list of selectable key names, spelled the way the music engine
 * spells them (circle-of-fifths flat/sharp preference via `keyToString`). One
 * entry per major and relative-minor tonic across all 12 pitch classes, deduped
 * by spelling so we never show both "F#" and "Gb" as separate major options.
 *
 * Reuses `@sundaysong/music` rather than hardcoding a parallel list, so the
 * selector can never drift from how the rest of the suite renders keys.
 */
export const KEY_OPTIONS: readonly string[] = buildKeyOptions();

function buildKeyOptions(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  // Majors first (C..B by pitch class), then the minors, each via the engine's
  // preferred spelling so accidentals read the conventional way.
  for (const minor of [false, true]) {
    for (let pc = 0; pc < 12; pc++) {
      const key: Key = { pc, minor };
      const name = keyToString(key);
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * Is `value` a key the engine can parse? Used to ignore a junk `?key=` param
 * rather than forwarding it to the API (where it would simply match nothing).
 */
export function isValidKey(value: string): boolean {
  return parseKey(value.trim()) !== null;
}

/** Parse a bpm string to a clamped-or-null integer; non-numeric => null. */
function parseBpm(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (i < BPM_MIN || i > BPM_MAX) return null;
  return i;
}

/**
 * Project the form state onto the SDK `SearchParams` filter fields (everything
 * except `q`/paging, which the caller owns). Drops empty / invalid values so we
 * never send `""`, an out-of-range bpm, or an unparseable key. When bpm_min >
 * bpm_max the range is normalised (swapped) rather than dropped — a flipped
 * range is a fat-finger, not "no filter".
 */
export function filtersToParams(state: SearchFilterState): Omit<SearchParams, "q" | "page" | "page_size"> {
  const params: Omit<SearchParams, "q" | "page" | "page_size"> = {};

  const language = state.language.trim();
  if (language) params.language = language;

  const theme = state.theme.trim();
  if (theme) params.themes = [theme];

  let lo = parseBpm(state.bpmMin);
  let hi = parseBpm(state.bpmMax);
  if (lo != null && hi != null && lo > hi) [lo, hi] = [hi, lo];
  if (lo != null) params.bpm_min = lo;
  if (hi != null) params.bpm_max = hi;

  const key = state.key.trim();
  if (key && isValidKey(key)) params.key = key;

  return params;
}

/**
 * Read filter state back out of the URL search params. Mirrors the param names
 * the page already uses for facets (`lang`, `theme`) so a single set of URL keys
 * drives both the controls and the facet sidebar. Invalid bpm/key values are
 * surfaced verbatim into the inputs (so the user can fix them) but won't be sent
 * by `filtersToParams`.
 */
export function filtersFromQuery(query: {
  lang?: string;
  theme?: string;
  bpm_min?: string;
  bpm_max?: string;
  key?: string;
}): SearchFilterState {
  return {
    language: query.lang?.trim() ?? "",
    theme: query.theme?.trim() ?? "",
    bpmMin: query.bpm_min?.trim() ?? "",
    bpmMax: query.bpm_max?.trim() ?? "",
    key: query.key?.trim() ?? "",
  };
}

/**
 * Serialise query + mode + filters into a `/songs` URLSearchParams, matching the
 * existing GET-form / facet-link conventions (`q`, `mode`, `lang`, `theme`,
 * plus the new `bpm_min`/`bpm_max`/`key`). Only non-empty, in-range values are
 * written, so the URL stays clean and shareable. Returns the param string
 * without the leading "?".
 */
export function buildSearchQuery(opts: {
  q: string;
  mode?: "text" | "meaning";
  filters: SearchFilterState;
}): string {
  const u = new URLSearchParams();
  const q = opts.q.trim();
  if (q) u.set("q", q);
  if (opts.mode === "meaning") u.set("mode", "meaning");

  const p = filtersToParams(opts.filters);
  if (p.language) u.set("lang", p.language);
  if (p.themes?.[0]) u.set("theme", p.themes[0]);
  if (p.bpm_min != null) u.set("bpm_min", String(p.bpm_min));
  if (p.bpm_max != null) u.set("bpm_max", String(p.bpm_max));
  if (p.key) u.set("key", p.key);

  return u.toString();
}

/** How many filters are active — drives the "clear" affordance + count badge. */
export function activeFilterCount(state: SearchFilterState): number {
  const p = filtersToParams(state);
  let n = 0;
  if (p.language) n += 1;
  if (p.themes?.length) n += 1;
  if (p.bpm_min != null || p.bpm_max != null) n += 1; // a range counts once
  if (p.key) n += 1;
  return n;
}
