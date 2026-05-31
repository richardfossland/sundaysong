/**
 * `@sundaysong/search` — Meilisearch client + song index.
 *
 * Full-text discovery (Phase 3.1): the canonical title plus every variant title
 * are indexed together, so a query in one language can surface a song catalogued
 * in another. Embedding-based semantic recall is Phase 3.2 (pgvector).
 */

export {
  MeiliClient,
  MeiliError,
  type EnqueuedTask,
  type TaskView,
  type SearchParams,
  type SearchResult,
} from "./client";
export { type SongDoc, songToSearchDoc, SONG_INDEX_SETTINGS } from "./songDoc";
export {
  type RankWeights,
  type RankedDoc,
  DEFAULT_RANK_WEIGHTS,
  foldNordic,
  tokenize,
  titleMatchScore,
  docTitleScore,
  rankScore,
  rankDocs,
} from "./ranking";
export { reindexSongs } from "./reindex";
export { DEFAULT_MEILI_HOST, DEFAULT_MEILI_KEY, SONG_INDEX } from "./config";
