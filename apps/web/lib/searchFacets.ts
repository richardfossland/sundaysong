/**
 * Pure, framework-free logic for the search-results facet sidebar.
 *
 * The /songs page already fetches a page of `SearchHit`s; this groups THOSE
 * hits (no extra API call) by theme, language and copyright status, producing
 * facet buckets with counts, and applies a chosen facet to narrow the rendered
 * list. Kept out of the React component so it can be unit-tested under
 * `bun test` with no DOM, API or network — the same offline-first discipline
 * the rest of the web app follows.
 *
 * The grouping is purely client-side over the fetched window, so counts reflect
 * the current page of results, not the whole catalog (there is no API change).
 */

import type { CopyrightStatus, SearchHit } from "@sundaysong/shared";

/** The three dimensions the sidebar groups by. */
export type FacetKind = "theme" | "language" | "copyright";

/** One selectable value within a facet group, with how many hits carry it. */
export interface FacetBucket {
  /** The raw value used for filtering (e.g. a theme string, "no", "public_domain"). */
  value: string;
  /** Display label (languages upper-cased, copyright humanised, themes verbatim). */
  label: string;
  /** How many of the fetched hits fall in this bucket. */
  count: number;
}

/** A named facet dimension with its buckets, ready to render as a sidebar block. */
export interface FacetGroup {
  kind: FacetKind;
  /** Section heading, e.g. "Theme", "Language", "Copyright". */
  title: string;
  buckets: FacetBucket[];
}

/** An active facet selection coming from the URL (one value per dimension). */
export interface FacetSelection {
  theme?: string;
  language?: string;
  copyright?: string;
}

const COPYRIGHT_LABEL: Record<CopyrightStatus, string> = {
  public_domain: "Public domain",
  copyrighted: "Copyrighted",
  unknown: "Unknown",
};

/** The set of languages a hit spans: the song's original plus every variant. */
function hitLanguages(hit: SearchHit): string[] {
  return Array.from(
    new Set([hit.song.original_language, ...hit.variants.map((v) => v.language)].filter(Boolean)),
  );
}

/**
 * Increment a value's tally in a bucket map, recording its label on first sight.
 * Keeps insertion order so callers get a stable, first-seen ordering before the
 * count sort.
 */
function tally(map: Map<string, FacetBucket>, value: string, label: string): void {
  const existing = map.get(value);
  if (existing) existing.count += 1;
  else map.set(value, { value, label, count: 1 });
}

/** Sort buckets by count desc, then label asc — the conventional facet order. */
function sortBuckets(buckets: FacetBucket[]): FacetBucket[] {
  return buckets.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * Group a page of search hits into theme / language / copyright facet buckets
 * with counts. Empty dimensions (e.g. no hit has any theme) are omitted so the
 * sidebar never renders a heading with nothing under it.
 */
export function buildFacets(hits: SearchHit[]): FacetGroup[] {
  const themes = new Map<string, FacetBucket>();
  const languages = new Map<string, FacetBucket>();
  const copyright = new Map<string, FacetBucket>();

  for (const hit of hits) {
    // A song can carry several themes / languages — it counts in each bucket it
    // belongs to, but only once per bucket (themes are de-duped at the source,
    // languages via hitLanguages' Set).
    for (const theme of hit.song.themes) tally(themes, theme, theme);
    for (const lang of hitLanguages(hit)) tally(languages, lang, lang.toUpperCase());
    const status = hit.song.copyright_status;
    tally(copyright, status, COPYRIGHT_LABEL[status] ?? status);
  }

  const groups: FacetGroup[] = [];
  if (languages.size) groups.push({ kind: "language", title: "Language", buckets: sortBuckets([...languages.values()]) });
  if (themes.size) groups.push({ kind: "theme", title: "Theme", buckets: sortBuckets([...themes.values()]) });
  if (copyright.size) groups.push({ kind: "copyright", title: "Copyright", buckets: sortBuckets([...copyright.values()]) });
  return groups;
}

/** Whether a single hit matches a chosen facet value on one dimension. */
function matchesFacet(hit: SearchHit, kind: FacetKind, value: string): boolean {
  switch (kind) {
    case "theme":
      return hit.song.themes.includes(value);
    case "language":
      return hitLanguages(hit).includes(value);
    case "copyright":
      return hit.song.copyright_status === value;
  }
}

/**
 * Narrow the fetched hits to those matching every active facet selection
 * (logical AND across dimensions). An empty selection returns the hits
 * unchanged. This filters only what was already fetched — it never touches
 * pagination or the reported `total`.
 */
export function applyFacets(hits: SearchHit[], selection: FacetSelection): SearchHit[] {
  const active: Array<[FacetKind, string]> = [];
  if (selection.theme) active.push(["theme", selection.theme]);
  if (selection.language) active.push(["language", selection.language]);
  if (selection.copyright) active.push(["copyright", selection.copyright]);
  if (active.length === 0) return hits;
  return hits.filter((hit) => active.every(([kind, value]) => matchesFacet(hit, kind, value)));
}

/** The query-param name a facet dimension toggles in the page URL. */
export function facetParam(kind: FacetKind): "theme" | "lang" | "copyright" {
  switch (kind) {
    case "theme":
      return "theme";
    case "language":
      return "lang";
    case "copyright":
      return "copyright";
  }
}
