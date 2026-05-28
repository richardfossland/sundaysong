/**
 * `@sundaysong/matching` — cross-language song matching (Phase 3.3).
 *
 * The killer discovery feature: surface a song's translations across languages.
 * Mechanism 1 resolves explicit Translation links into a sorted list;
 * Mechanism 2 scores candidate links from language-agnostic metadata for an
 * admin (or AI classifier) to confirm. Pure — no DB, no network.
 */

export type {
  TranslationEdge,
  TranslationSongMeta,
  ResolvedRelationship,
  TranslationLink,
  MatchSong,
  MatchSignal,
  Recommendation,
  CandidateScore,
} from "./types";
export { resolveTranslations } from "./translations";
export { scoreTranslationCandidate, proposeCandidates } from "./candidates";
