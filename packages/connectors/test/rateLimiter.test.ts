import { describe, expect, test } from "bun:test";
import { createBucket, refill, tryTake, type RateLimit } from "../src/rateLimiter";

const LIMIT: RateLimit = { ratePerSec: 2, capacity: 5 };

describe("token bucket", () => {
  test("starts full", () => {
    expect(createBucket(LIMIT, 1000).tokens).toBe(5);
  });

  test("refills over time, capped at capacity", () => {
    const b = { tokens: 0, lastMs: 0 };
    expect(refill(b, LIMIT, 1000).tokens).toBe(2); // 1s * 2/s
    expect(refill(b, LIMIT, 10_000).tokens).toBe(5); // would be 20, capped at 5
  });

  test("take consumes a token", () => {
    const b = createBucket(LIMIT, 0);
    const r = tryTake(b, LIMIT, 0);
    expect(r.ok).toBe(true);
    expect(r.bucket.tokens).toBe(4);
  });

  test("empty bucket reports the wait until one token", () => {
    const empty = { tokens: 0, lastMs: 0 };
    const r = tryTake(empty, LIMIT, 0);
    expect(r.ok).toBe(false);
    expect(r.waitMs).toBe(500); // 1 token at 2/s = 500ms
  });

  test("draining then waiting lets a take succeed", () => {
    let b = createBucket({ ratePerSec: 1, capacity: 1 }, 0);
    b = tryTake(b, { ratePerSec: 1, capacity: 1 }, 0).bucket; // now empty
    expect(tryTake(b, { ratePerSec: 1, capacity: 1 }, 500).ok).toBe(false);
    expect(tryTake(b, { ratePerSec: 1, capacity: 1 }, 1000).ok).toBe(true);
  });
});
