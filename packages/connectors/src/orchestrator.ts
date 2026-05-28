/**
 * Sync orchestrator.
 *
 * Drives a Connector through one import pass with rate limiting, bounded
 * concurrency, retry-with-backoff on transient errors, and a dead-letter queue
 * for permanent ones. All side effects — the clock, sleeping, the upsert write,
 * logging — are injected, so the whole thing runs deterministically in tests
 * with no real time, network, or database.
 */

import type { Connector, NormalizedSong, SyncError, SyncRunState } from "./types";
import { classifyError, shouldRetry, nextDelayMs, DEFAULT_RETRY, type RetryPolicy } from "./backoff";
import { createBucket, tryTake, type RateLimit, type TokenBucket } from "./rateLimiter";
import { startRun, recordAdded, recordUpdated, recordError, finishRun } from "./syncRun";

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

const NOOP_LOGGER: Logger = { info() {}, warn() {}, error() {} };

export interface RunSyncDeps {
  /** Upsert keyed on `source_external_id`; returns whether it was new. */
  upsert: (song: NormalizedSong) => Promise<"added" | "updated">;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  logger?: Logger;
  /** Injectable RNG for backoff jitter (deterministic tests). */
  rand?: () => number;
}

export interface RunSyncOptions {
  rateLimit?: RateLimit;
  retry?: RetryPolicy;
  concurrency?: number;
  /** Safety bound on discovery pages. */
  maxPages?: number;
}

export interface RunSyncResult {
  run: SyncRunState;
  imported: NormalizedSong[];
  deadLetter: SyncError[];
}

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function runSync(
  connector: Connector,
  deps: RunSyncDeps,
  options: RunSyncOptions = {},
): Promise<RunSyncResult> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const logger = deps.logger ?? NOOP_LOGGER;
  const rand = deps.rand ?? Math.random;
  const retry = options.retry ?? DEFAULT_RETRY;
  const limit: RateLimit = options.rateLimit ?? { ratePerSec: 1_000_000, capacity: 1_000_000 };
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const maxPages = options.maxPages ?? 100_000;

  let run = startRun(connector.source, now());
  const imported: NormalizedSong[] = [];

  let bucket: TokenBucket = createBucket(limit, now());
  const acquire = async () => {
    for (;;) {
      const r = tryTake(bucket, limit, now());
      bucket = r.bucket;
      if (r.ok) return;
      await sleep(r.waitMs);
    }
  };

  // Run an async op with retry/backoff; resolves to a value or a SyncError.
  async function withRetry<T>(externalId: string, op: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: SyncError }> {
    let last: unknown;
    for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
      try {
        return { ok: true, value: await op() };
      } catch (e) {
        last = e;
        const kind = classifyError(e);
        if (!shouldRetry(attempt, kind, retry)) {
          return { ok: false, error: { external_id: externalId, message: errMessage(e), kind, attempts: attempt } };
        }
        logger.warn("sync_item_retry", { source: connector.source, externalId, attempt, kind });
        await sleep(nextDelayMs(attempt, retry, rand));
      }
    }
    return {
      ok: false,
      error: { external_id: externalId, message: errMessage(last), kind: classifyError(last), attempts: retry.maxAttempts },
    };
  }

  logger.info("sync_start", { source: connector.source });

  // ── 1. Discover all external ids (deduped) ──────────────────────────────────
  const ids: string[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  let pages = 0;
  do {
    await acquire();
    const label = `discover:${cursor ?? "start"}`;
    const page = await withRetry(label, () => connector.discover(cursor));
    if (!page.ok) {
      run = recordError(run, page.error);
      logger.error("sync_discover_failed", { source: connector.source, cursor, message: page.error.message });
      break;
    }
    for (const id of page.value.externalIds) {
      if (!seen.has(id)) { seen.add(id); ids.push(id); }
    }
    cursor = page.value.nextCursor;
    pages += 1;
  } while (cursor !== undefined && pages < maxPages);

  logger.info("sync_discovered", { source: connector.source, count: ids.length, pages });

  // ── 2. Fetch + normalize + upsert each item with bounded concurrency ────────
  let idx = 0;
  const worker = async () => {
    for (;;) {
      const i = idx++;
      if (i >= ids.length) return;
      const id = ids[i]!;

      await acquire();
      const fetched = await withRetry(id, () => connector.fetch(id));
      if (!fetched.ok) { run = recordError(run, fetched.error); continue; }

      let normalized: NormalizedSong;
      try {
        normalized = connector.normalize(fetched.value);
      } catch (e) {
        // normalize() is pure; a throw means data we can never accept.
        run = recordError(run, { external_id: id, message: errMessage(e), kind: "permanent", attempts: 1 });
        continue;
      }

      const written = await withRetry(id, () => deps.upsert(normalized));
      if (!written.ok) { run = recordError(run, written.error); continue; }

      imported.push(normalized);
      run = written.value === "added" ? recordAdded(run) : recordUpdated(run);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  run = finishRun(run, now());
  logger.info("sync_finish", {
    source: connector.source,
    status: run.status,
    added: run.songs_added,
    updated: run.songs_updated,
    dead_letter: run.errors.length,
  });

  return { run, imported, deadLetter: run.errors };
}
