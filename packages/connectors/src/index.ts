/**
 * `@sundaysong/connectors` — the source-import framework.
 *
 * Adding a new source = implementing one `Connector` (discover / fetch /
 * normalize) and handing it to `runSync`. The orchestrator owns rate limiting,
 * retries, concurrency, dead-lettering, and run tracking, so a new connector
 * never re-implements the pipeline. Real connectors (Hymnary, salmebok, user
 * uploads) land in Phase 2.2; `TestConnector` exercises everything until then.
 */

export type {
  Connector,
  DiscoverPage,
  NormalizedSong,
  SyncStatus,
  ErrorKind,
  SyncError,
  SyncRunState,
} from "./types";
export { type RetryPolicy, DEFAULT_RETRY, classifyError, shouldRetry, nextDelayMs } from "./backoff";
export {
  type RateLimit,
  type TokenBucket,
  type TakeResult,
  createBucket,
  refill,
  tryTake,
} from "./rateLimiter";
export { startRun, recordAdded, recordUpdated, recordError, finishRun } from "./syncRun";
export {
  type Logger,
  type RunSyncDeps,
  type RunSyncOptions,
  type RunSyncResult,
  runSync,
} from "./orchestrator";
export {
  type RawTestSong,
  type TestConnectorOptions,
  TestConnector,
  TEST_CATALOG_SIZE,
} from "./testConnector";
export {
  type RawSalmebokHymn,
  SalmebokConnector,
  SALMEBOK_CATALOG_SIZE,
} from "./sources/salmebok";
export {
  type RawHymnaryText,
  type RawHymnaryAuthor,
  type CopyrightDecision,
  type HymnaryConnectorOptions,
  HymnaryConnector,
  normalizeHymnary,
  decideCopyright,
  parseHymnaryYear,
  HYMNARY_API_BASE,
  PD_PUBLICATION_CUTOFF,
  PD_LIFE_PLUS_YEARS,
} from "./sources/hymnary";
