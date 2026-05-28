/**
 * Cross-language matching — types.
 *
 * Two mechanisms behind "find 'Herre, jeg løfter ditt navn' when you search
 * 'Lord I lift Your name on high'":
 *   1. Explicit Translation links (highest confidence) — resolved into a
 *      sorted "available translations" list.
 *   2. Candidate proposals — score two songs on language-agnostic metadata to
 *      propose a link an admin (or an AI classifier) can confirm.
 *
 * Embedding-based *recall* (finding candidates across the whole corpus) lives
 * in the search layer (Phase 3.2, needs pgvector); this package is the pure
 * resolution + scoring that runs on top of whatever candidates it is given.
 */

import type { TranslationRelationship } from "@sundaysong/shared";

/** A directed Translation edge, as stored in the `translation` table. */
export interface TranslationEdge {
  source_song_id: string;
  target_song_id: string;
  relationship: TranslationRelationship;
  verified_by?: "admin" | "community" | "ai_with_review";
}

/** Minimal per-song metadata needed to label a resolved link. */
export interface TranslationSongMeta {
  language: string;
  canonical_title: string;
}

/** "transitive" = reached only through another translation, not a direct edge. */
export type ResolvedRelationship = TranslationRelationship | "transitive";

export interface TranslationLink {
  song_id: string;
  language: string;
  title: string;
  relationship: ResolvedRelationship;
  verified_by?: "admin" | "community" | "ai_with_review";
  /** True when a Translation edge connects this song directly to the query. */
  direct: boolean;
}

// ── Candidate scoring ─────────────────────────────────────────────────────────

/** The subset of song metadata the candidate scorer reads. */
export interface MatchSong {
  id: string;
  canonical_title: string;
  /** Primary language (BCP-47-ish: "en", "no", "nb", "sv", "da"). */
  language: string;
  themes?: string[];
  bible_refs?: string[];
  year_first_published?: number | null;
  composer_ids?: string[];
  ccli_song_id?: string | null;
  tono_work_id?: string | null;
}

export interface MatchSignal {
  name: string;
  /** Points this signal contributed (before normalization). */
  weight: number;
  detail?: string;
}

export type Recommendation = "auto_link" | "propose" | "reject";

export interface CandidateScore {
  a_id: string;
  b_id: string;
  /** 0..1. */
  confidence: number;
  recommendation: Recommendation;
  signals: MatchSignal[];
}
