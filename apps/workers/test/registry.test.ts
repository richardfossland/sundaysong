import { describe, expect, test } from "bun:test";
import { connectors, getConnector, getRunOptions, RATE_LIMITS } from "../src/registry";

describe("getConnector", () => {
  test("returns each registered connector with a matching source name", () => {
    for (const name of Object.keys(connectors)) {
      expect(getConnector(name).source).toBe(name);
    }
  });

  test("throws a listing the known names on an unknown connector", () => {
    expect(() => getConnector("nope")).toThrow(/unknown connector "nope"/);
    expect(() => getConnector("nope")).toThrow(/hymnary/);
  });
});

describe("getRunOptions (per-source rate limiting, Phase 2.2)", () => {
  test("hymnary carries a polite, capped rate limit", () => {
    const opts = getRunOptions("hymnary");
    expect(opts.rateLimit).toEqual(RATE_LIMITS.hymnary);
    expect(opts.rateLimit!.ratePerSec).toBeLessThanOrEqual(2);
    expect(opts.rateLimit!.capacity).toBeGreaterThan(0);
    expect(opts.concurrency).toBeGreaterThan(0);
  });

  test("an unthrottled in-memory source omits rateLimit (uses orchestrator default)", () => {
    const opts = getRunOptions("salmebok");
    expect(opts.rateLimit).toBeUndefined();
    expect(opts.concurrency).toBeGreaterThan(0);
  });
});
