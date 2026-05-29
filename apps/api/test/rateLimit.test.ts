import { describe, expect, test } from "bun:test";
import { RateLimiter } from "../src/middleware/rateLimit";

describe("RateLimiter", () => {
  test("allows up to the limit, then blocks within the window", () => {
    const rl = new RateLimiter(3, 1000);
    expect(rl.take("a", 0).ok).toBe(true);
    expect(rl.take("a", 0).ok).toBe(true);
    const third = rl.take("a", 0);
    expect(third.ok).toBe(true);
    expect(third.remaining).toBe(0);
    const fourth = rl.take("a", 100);
    expect(fourth.ok).toBe(false);
    expect(fourth.retryAfterMs).toBe(900);
  });

  test("resets after the window elapses", () => {
    const rl = new RateLimiter(1, 1000);
    expect(rl.take("a", 0).ok).toBe(true);
    expect(rl.take("a", 500).ok).toBe(false);
    expect(rl.take("a", 1000).ok).toBe(true); // new window
  });

  test("keys are isolated", () => {
    const rl = new RateLimiter(1, 1000);
    expect(rl.take("a", 0).ok).toBe(true);
    expect(rl.take("b", 0).ok).toBe(true);
  });
});
