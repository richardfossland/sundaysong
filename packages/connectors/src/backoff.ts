/**
 * Retry policy: error classification + exponential backoff with full jitter.
 *
 * Only *transient* failures (network blips, 429s, 5xx) are retried; a 4xx or a
 * normalize() that throws is *permanent* and goes straight to the dead-letter
 * queue so we don't hammer a source over data it will never accept.
 */

import type { ErrorKind } from "./types";

export interface RetryPolicy {
  baseMs: number;
  maxMs: number;
  factor: number;
  /** Total attempts including the first try. */
  maxAttempts: number;
}

export const DEFAULT_RETRY: RetryPolicy = {
  baseMs: 200,
  maxMs: 30_000,
  factor: 2,
  maxAttempts: 5,
};

/** Decide whether a thrown value is worth retrying. */
export function classifyError(err: unknown): ErrorKind {
  const status = readStatus(err);
  if (status !== null) {
    if (status === 408 || status === 429 || status >= 500) return "transient";
    return "permanent"; // other 4xx — bad request, not found, unauthorized
  }
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (/network|fetch failed|timeout|timed out|econn|etimedout|socket|temporar/.test(msg)) {
    return "transient";
  }
  return "permanent";
}

function readStatus(err: unknown): number | null {
  if (typeof err === "object" && err !== null) {
    const s = (err as { status?: unknown; statusCode?: unknown }).status ??
      (err as { statusCode?: unknown }).statusCode;
    if (typeof s === "number") return s;
  }
  return null;
}

/** Should we retry after this attempt (1-based) given the error kind? */
export function shouldRetry(attempt: number, kind: ErrorKind, policy: RetryPolicy): boolean {
  return kind === "transient" && attempt < policy.maxAttempts;
}

/**
 * Delay before the next attempt. `attempt` is 1-based (1 = after the first
 * failure). Full jitter: a uniform pick in [0, cappedExponential]. `rand` is
 * injectable so tests are deterministic.
 */
export function nextDelayMs(attempt: number, policy: RetryPolicy, rand: () => number = Math.random): number {
  const exp = policy.baseMs * Math.pow(policy.factor, Math.max(0, attempt - 1));
  const capped = Math.min(policy.maxMs, exp);
  return Math.floor(rand() * capped);
}
