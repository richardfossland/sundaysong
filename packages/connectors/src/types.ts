/**
 * Source connector framework — types.
 *
 * A connector knows how to talk to one external source (Hymnary, a salmebok
 * dataset, user uploads, ...). The import pipeline only knows this interface,
 * so a new source is added by writing one `Connector` — never by touching the
 * orchestrator. Each connector does three things:
 *
 *   discover()  — page through the source's catalog, yielding external ids
 *   fetch(id)   — pull one record's full payload in the source's own shape
 *   normalize() — map that payload onto our neutral `NormalizedSong`
 *
 * The orchestrator handles rate limiting, retries, concurrency, dead-lettering
 * and run tracking around those three calls.
 */

import type { CopyrightStatus } from "@sundaysong/shared";

/** One page of discovery results. `nextCursor === undefined` means done. */
export interface DiscoverPage {
  externalIds: string[];
  nextCursor?: string;
}

/**
 * A source-neutral song + its single variant, ready to upsert. The
 * `source_external_id` is the idempotency anchor: re-importing the same record
 * updates rather than duplicates.
 */
export interface NormalizedSong {
  source: string;
  source_external_id: string;

  canonical_title: string;
  original_language: string;
  copyright_status: CopyrightStatus;
  year_first_published?: number;
  ccli_song_id?: string;
  tono_work_id?: string;
  hymnary_id?: string;
  themes?: string[];

  variant: {
    title: string;
    language: string;
    key?: string;
    lyrics_url?: string;
    lyrics_excerpt?: string;
    attribution_text: string;
  };
}

/** The contract every source implements. `TRaw` is the source's own payload. */
export interface Connector<TRaw = unknown> {
  /** Stable source name; matches a row in the `source` table. */
  readonly source: string;
  discover(cursor?: string): Promise<DiscoverPage>;
  fetch(externalId: string): Promise<TRaw>;
  /** Pure mapping — no I/O. Throws on data it cannot map (a permanent error). */
  normalize(raw: TRaw): NormalizedSong;
}

export type SyncStatus = "running" | "succeeded" | "partial" | "failed";
export type ErrorKind = "transient" | "permanent";

export interface SyncError {
  external_id: string;
  message: string;
  kind: ErrorKind;
  attempts: number;
}

export interface SyncRunState {
  source: string;
  status: SyncStatus;
  started_at_ms: number;
  finished_at_ms?: number;
  songs_added: number;
  songs_updated: number;
  /** Permanent failures that were dead-lettered. */
  errors: SyncError[];
}
