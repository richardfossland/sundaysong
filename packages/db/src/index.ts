/**
 * `@sundaysong/db` — Postgres migrations + tooling.
 *
 * Schema lives in `migrations/*.sql`; `migrate.ts` applies them with Bun.SQL
 * (no external driver). The repository layer (Phase 1.2) will live here too.
 */

export { sortMigrations, computePending } from "./planner";
export { DEFAULT_DATABASE_URL, MIGRATIONS_DIR } from "./config";
export { type Sql, createSql, getSql } from "./sql";

export type { Executor } from "./repositories/types";
export {
  type SourceRow,
  type SourceKind,
  type UpsertSourceInput,
  type SourceWithCount,
  upsertSource,
  getSourceByName,
  listSources,
} from "./repositories/sources";
export {
  type SongInput,
  insertSong,
  updateSong,
  getSong,
  searchSongsByTitle,
  countSongsByTitle,
  listSongs,
  getSongsByIds,
} from "./repositories/songs";
export { getChurchLicensing, upsertChurchLicensing } from "./repositories/church";
export { type PersonRow, upsertPerson, linkLyricist, lyricistsForSong } from "./repositories/persons";
export {
  type TranslationRelationship,
  type TranslationVerifiedBy,
  type LinkTranslationInput,
  type TranslationLink,
  linkTranslation,
  translationsForSong,
  translationsForSongs,
} from "./repositories/translations";
export { type VariantInput, upsertVariant, listVariantsForSong } from "./repositories/variants";
export { type LogUsageInput, logUsage, usageForPeriod } from "./repositories/usage";
export {
  type EmbeddingEntity,
  type UpsertEmbeddingInput,
  type NearestSong,
  type NearestSongsInput,
  upsertEmbedding,
  nearestSongs,
  songsMissingEmbedding,
} from "./repositories/embeddings";
export {
  type UpsertSongWithVariantInput,
  type UpsertResult,
  upsertSongWithVariant,
} from "./repositories/ingest";
export {
  type CreateUploadInput,
  type ModerationNote,
  createUpload,
  listUploadsByStatus,
  getUpload,
  updateUploadStatus,
  addModerationNote,
  moderationHistory,
  uploadCountsByStatus,
} from "./repositories/uploads";
