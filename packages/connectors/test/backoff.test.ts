import { describe, expect, test } from "bun:test";
import { classifyError, shouldRetry, nextDelayMs, DEFAULT_RETRY } from "../src/backoff";

describe("classifyError", () => {
  test("429 / 5xx / 408 are transient", () => {
    expect(classifyError({ status: 429 })).toBe("transient");
    expect(classifyError({ status: 503 })).toBe("transient");
    expect(classifyError({ status: 500 })).toBe("transient");
    expect(classifyError({ status: 408 })).toBe("transient");
  });

  test("other 4xx are permanent", () => {
    expect(classifyError({ status: 404 })).toBe("permanent");
    expect(classifyError({ status: 400 })).toBe("permanent");
    expect(classifyError({ status: 401 })).toBe("permanent");
  });

  test("network-ish messages are transient", () => {
    expect(classifyError(new Error("fetch failed"))).toBe("transient");
    expect(classifyError(new Error("network timeout"))).toBe("transient");
    expect(classifyError(new Error("ECONNRESET"))).toBe("transient");
  });

  test("unknown errors default to permanent", () => {
    expect(classifyError(new Error("cannot parse field"))).toBe("permanent");
    expect(classifyError("weird")).toBe("permanent");
  });
});

describe("shouldRetry", () => {
  test("retries transient until the attempt budget runs out", () => {
    expect(shouldRetry(1, "transient", DEFAULT_RETRY)).toBe(true);
    expect(shouldRetry(DEFAULT_RETRY.maxAttempts, "transient", DEFAULT_RETRY)).toBe(false);
  });
  test("never retries permanent", () => {
    expect(shouldRetry(1, "permanent", DEFAULT_RETRY)).toBe(false);
  });
});

describe("nextDelayMs", () => {
  const policy = { baseMs: 100, maxMs: 5000, factor: 2, maxAttempts: 6 };

  test("grows exponentially at the jitter ceiling (rand=1)", () => {
    expect(nextDelayMs(1, policy, () => 1)).toBe(100);
    expect(nextDelayMs(2, policy, () => 1)).toBe(200);
    expect(nextDelayMs(3, policy, () => 1)).toBe(400);
  });

  test("caps at maxMs", () => {
    expect(nextDelayMs(20, policy, () => 1)).toBe(5000);
  });

  test("full jitter keeps delay within [0, ceiling]", () => {
    expect(nextDelayMs(3, policy, () => 0)).toBe(0);
    expect(nextDelayMs(3, policy, () => 0.5)).toBe(200);
  });
});
