/**
 * Pure text ranking helpers (Phase 3.1).
 *
 * Meilisearch does the heavy lifting in production, but we still need a
 * dependency-free, deterministic scorer for three reasons:
 *   1. an OFFLINE fallback so search degrades gracefully when Meili is down;
 *   2. a stable tiebreaker that folds in our own popularity signal, which the
 *      raw engine ranking does not know about;
 *   3. something we can actually unit-test — Nordic tokenization is where the
 *      "best worship search for Nordic languages" promise is won or lost.
 *
 * The hard part is Nordic-aware matching. We fold combining diacritics
 * (é→e, ü→u) AND the special letters å→a, ä→a, ø/ö→o, æ→ae, ß→ss to their base
 * forms, so a query typed without the right keyboard ("nar mitt oye") still
 * matches "Når mitt øye". Zero dependencies; offline.
 *
 * `foldNordic`/`tokenize` are the single source of truth and now live in
 * @sundaysong/shared so the translation matcher folds identically; we re-export
 * them here to keep the search package's public API stable.
 */

import { foldNordic, tokenize } from "@sundaysong/shared";
import type { SongDoc } from "./songDoc";

export { foldNordic, tokenize };

/**
 * Score a single candidate title against a query, 0..1, on a tiered ladder:
 *   exact match ............................. 1.0
 *   query is a prefix of the title .......... 0.9
 *   all query tokens present, in order ...... 0.8
 *   all query tokens present, any order ..... 0.7
 *   some query tokens present ............... up to ~0.6 (by coverage)
 *   no token overlap ........................ 0.0
 * Folding is Nordic-aware so accent/keyboard differences never cost a tier.
 */
export function titleMatchScore(query: string, title: string): number {
  const q = foldNordic(query).trim();
  const t = foldNordic(title).trim();
  if (!q || !t) return 0;
  if (q === t) return 1;
  if (t.startsWith(q)) return 0.9;

  const qTokens = tokenize(query);
  const tTokens = tokenize(title);
  if (qTokens.length === 0) return 0;

  const tSet = new Set(tTokens);
  const present = qTokens.filter((tok) => tSet.has(tok));
  if (present.length === 0) return 0;

  if (present.length === qTokens.length) {
    // All present — reward in-order (subsequence) matches over scrambled ones.
    return isSubsequence(qTokens, tTokens) ? 0.8 : 0.7;
  }

  // Partial coverage, capped below the "all present" tier.
  const coverage = present.length / qTokens.length;
  return Math.round(coverage * 0.6 * 100) / 100;
}

/** True if `needle` appears as an ordered (not necessarily contiguous) subsequence of `hay`. */
function isSubsequence(needle: string[], hay: string[]): boolean {
  let i = 0;
  for (const h of hay) {
    if (i < needle.length && h === needle[i]) i += 1;
  }
  return i === needle.length;
}

/** A doc's best title score is the strongest match across all its titles. */
export function docTitleScore(query: string, doc: SongDoc): number {
  return doc.titles.reduce((best, t) => Math.max(best, titleMatchScore(query, t)), 0);
}

export interface RankWeights {
  /** Weight of the text match (default dominates). */
  text: number;
  /** Weight of normalized popularity, as a gentle tiebreaker. */
  popularity: number;
  /** popularity_score is divided by this to land roughly in 0..1. */
  popularityScale: number;
}

export const DEFAULT_RANK_WEIGHTS: RankWeights = {
  text: 0.85,
  popularity: 0.15,
  popularityScale: 10,
};

/**
 * Blend a doc's text score with its popularity into a final 0..1 rank score.
 * Text dominates; popularity only separates near-ties (so a wildly popular song
 * never outranks a clearly better title match, but does win a coin-flip).
 */
export function rankScore(
  query: string,
  doc: SongDoc,
  weights: RankWeights = DEFAULT_RANK_WEIGHTS,
): number {
  const text = docTitleScore(query, doc);
  if (text === 0) return 0; // no text match ⇒ not a result, regardless of popularity
  const pop = Math.min(1, Math.max(0, doc.popularity_score / weights.popularityScale));
  const raw = weights.text * text + weights.popularity * pop;
  return Math.round(raw * 1000) / 1000;
}

export interface RankedDoc {
  doc: SongDoc;
  score: number;
}

/**
 * Rank docs against a query, drop non-matches, and sort best-first. Ties break
 * deterministically by popularity then canonical title, so the order is stable
 * across runs (important for snapshot-style API contracts and pagination).
 */
export function rankDocs(
  query: string,
  docs: SongDoc[],
  weights: RankWeights = DEFAULT_RANK_WEIGHTS,
): RankedDoc[] {
  return docs
    .map((doc) => ({ doc, score: rankScore(query, doc, weights) }))
    .filter((r) => r.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.doc.popularity_score - a.doc.popularity_score ||
        a.doc.canonical_title.localeCompare(b.doc.canonical_title),
    );
}
