import { describe, expect, it } from "bun:test";
import { buildErrorEvent, parseDsn, reportError } from "../src/lib/observability";

describe("parseDsn", () => {
  it("extracts the store endpoint and key", () => {
    expect(parseDsn("https://abc123@o9999.ingest.sentry.io/4500")).toEqual({
      storeUrl: "https://o9999.ingest.sentry.io/api/4500/store/",
      publicKey: "abc123",
    });
  });
  it("rejects malformed DSNs", () => {
    expect(parseDsn("not-a-url")).toBeNull();
    expect(parseDsn("https://host/123")).toBeNull(); // no key
    expect(parseDsn("https://key@host/")).toBeNull(); // no project
  });
});

describe("buildErrorEvent", () => {
  it("shapes an Error with stack into a Sentry event", () => {
    const ev = buildErrorEvent(new RangeError("boom"), { app: "plan-web" });
    expect(ev.level).toBe("error");
    expect(ev.tags).toEqual({ app: "plan-web" });
    const values = (ev.exception as { values: { type: string; value: string }[] }).values;
    expect(values[0].type).toBe("RangeError");
    expect(values[0].value).toBe("boom");
  });
  it("wraps non-Error throwables", () => {
    const ev = buildErrorEvent("string-failure", { app: "x" });
    const values = (ev.exception as { values: { value: string }[] }).values;
    expect(values[0].value).toBe("string-failure");
  });
});

describe("reportError", () => {
  it("is a no-op without a DSN (no fetch, returns false)", async () => {
    let called = false;
    const attempted = await reportError(new Error("x"), { app: "a" }, {}, async () => {
      called = true;
      return new Response(null);
    });
    expect(attempted).toBe(false);
    expect(called).toBe(false);
  });

  it("posts to the store endpoint when a DSN is set", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const attempted = await reportError(
      new Error("kaboom"),
      { app: "plan-web", extra: { route: "/api/export" } },
      { SENTRY_DSN: "https://k@o1.ingest.sentry.io/42", SENTRY_ENVIRONMENT: "production" },
      async (url, init) => {
        calls.push({ url, init });
        return new Response(null, { status: 200 });
      },
    );
    expect(attempted).toBe(true);
    expect(calls[0].url).toBe("https://o1.ingest.sentry.io/api/42/store/");
    const body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
    expect(body.environment).toBe("production");
    expect((body.extra as Record<string, unknown>).route).toBe("/api/export");
    expect(String((calls[0].init?.headers as Record<string, string>)["X-Sentry-Auth"])).toContain(
      "sentry_key=k",
    );
  });

  it("never throws when the transport fails", async () => {
    const attempted = await reportError(
      new Error("x"),
      { app: "a" },
      { SENTRY_DSN: "https://k@h.io/1" },
      async () => {
        throw new Error("network down");
      },
    );
    expect(attempted).toBe(true);
  });
});
