/**
 * Song -> Meilisearch document mapping (pure).
 *
 * We flatten the canonical song plus its per-source variant titles/languages
 * into one searchable document. Indexing the variant titles is what lets a
 * search for the English title surface the Norwegian song and vice-versa,
 * before the embedding-based cross-language layer (Phase 3.2) exists.
 */

import type { Song, SongVariant } from "@sundaysong/shared";

export interface SongDoc {
  id: string;
  canonical_title: string;
  /** Canonical + every variant title, deduped. */
  titles: string[];
  /** Original + every variant language, deduped. */
  languages: string[];
  themes: string[];
  bible_refs: string[];
  copyright_status: Song["copyright_status"];
  tono_work_id: string | null;
  ccli_song_id: string | null;
  popularity_score: number;
}

const uniq = (xs: string[]): string[] => [...new Set(xs.filter(Boolean))];

export function songToSearchDoc(song: Song, variants: SongVariant[]): SongDoc {
  return {
    id: song.id,
    canonical_title: song.canonical_title,
    titles: uniq([song.canonical_title, ...variants.map((v) => v.title)]),
    languages: uniq([song.original_language, ...variants.map((v) => v.language)]),
    themes: song.themes ?? [],
    bible_refs: song.bible_refs ?? [],
    copyright_status: song.copyright_status,
    tono_work_id: song.tono_work_id,
    ccli_song_id: song.ccli_song_id,
    popularity_score: song.popularity_score ?? 0,
  };
}

/** Index settings — what's searchable, filterable, and sortable. */
export const SONG_INDEX_SETTINGS = {
  searchableAttributes: ["canonical_title", "titles", "themes", "bible_refs"],
  filterableAttributes: ["languages", "themes", "copyright_status", "tono_work_id", "ccli_song_id"],
  sortableAttributes: ["popularity_score"],
} as const;
