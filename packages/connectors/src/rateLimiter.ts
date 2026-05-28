/**
 * Per-source token-bucket rate limiter.
 *
 * Pure and clock-injected: every function takes `nowMs`, so the orchestrator
 * (and tests) control time rather than the wall clock. External APIs like
 * Hymnary and Spotify have aggressive quotas; one bucket per source keeps us
 * polite without a global lock.
 */

export interface RateLimit {
  /** Sustained tokens added per second. */
  ratePerSec: number;
  /** Burst size — the most tokens the bucket can hold. */
  capacity: number;
}

export interface TokenBucket {
  tokens: number;
  lastMs: number;
}

export function createBucket(limit: RateLimit, nowMs: number): TokenBucket {
  return { tokens: limit.capacity, lastMs: nowMs };
}

/** Add tokens accrued since `lastMs`, capped at capacity. */
export function refill(bucket: TokenBucket, limit: RateLimit, nowMs: number): TokenBucket {
  const elapsedSec = Math.max(0, (nowMs - bucket.lastMs) / 1000);
  const tokens = Math.min(limit.capacity, bucket.tokens + elapsedSec * limit.ratePerSec);
  return { tokens, lastMs: nowMs };
}

export interface TakeResult {
  ok: boolean;
  bucket: TokenBucket;
  /** When !ok, how long to wait before one token is available. */
  waitMs: number;
}

/** Try to consume one token. On failure, reports how long to wait. */
export function tryTake(bucket: TokenBucket, limit: RateLimit, nowMs: number): TakeResult {
  const refilled = refill(bucket, limit, nowMs);
  if (refilled.tokens >= 1) {
    return { ok: true, bucket: { tokens: refilled.tokens - 1, lastMs: refilled.lastMs }, waitMs: 0 };
  }
  const deficit = 1 - refilled.tokens;
  const waitMs = Math.ceil((deficit / limit.ratePerSec) * 1000);
  return { ok: false, bucket: refilled, waitMs };
}
