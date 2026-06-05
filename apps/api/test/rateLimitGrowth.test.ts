import { describe, expect, test } from "bun:test";
import { RateLimiter } from "../src/middleware/rateLimit";

/**
 * Memory-safety guard for the in-memory limiter.
 *
 * The limiter keys one Window per caller (API key or forwarded IP). A caller can
 * be spoofed cheaply (rotate `X-Forwarded-For` or the bearer prefix), so the
 * window map MUST NOT grow without bound when many DISTINCT keys arrive inside a
 * single window — otherwise an attacker exhausts process memory. Expired windows
 * are reclaimed on creation, but a flood that never lets a window expire would
 * still grow forever unless the map is hard-capped.
 */
describe("RateLimiter — bounded memory under a unique-key flood", () => {
  test("map stays bounded even when 50k distinct keys hit one window", () => {
    const rl = new RateLimiter(5, 60_000);
    // All within the same 60s window — none of these ever expire during the flood.
    for (let i = 0; i < 50_000; i++) rl.take(`ip:${i}`, 0);
    expect(rl.size()).toBeLessThanOrEqual(10_000);
  });

  test("still rate-limits a live key after the flood (no false eviction of hot keys)", () => {
    const rl = new RateLimiter(2, 60_000);
    // Hot key established first; it has activity, so it must survive eviction.
    expect(rl.take("hot", 0).ok).toBe(true);
    expect(rl.take("hot", 0).ok).toBe(true);
    for (let i = 0; i < 50_000; i++) rl.take(`ip:${i}`, 1);
    // hot is over its limit of 2 within the window; the limiter must remember it.
    expect(rl.take("hot", 2).ok).toBe(false);
  });
});
