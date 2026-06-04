import { describe, expect, test } from "bun:test";
import { UsageEvent } from "@sundaysong/shared";
import { SundaySong, SundaySongError, type RecommendSeasonOutput } from "../src/index";

function mockFetch(responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: string[] = [];
  let i = 0;
  const fetch = (async (url: string) => {
    calls.push(String(url));
    const r = responses[Math.min(i++, responses.length - 1)]!;
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), {
      status: r.status,
      headers: r.headers,
    });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const noSleep = async () => {};

describe("SundaySong client", () => {
  test("returns parsed JSON on success", async () => {
    const { fetch } = mockFetch([{ status: 200, body: { hits: [], total: 0, page: 0, page_size: 20, engine: "meilisearch" } }]);
    const api = new SundaySong({ fetch, sleep: noSleep });
    const res = await api.songs.search({ q: "grace" });
    expect(res.engine).toBe("meilisearch");
  });

  test("retries on 503 then succeeds", async () => {
    const { fetch, calls } = mockFetch([
      { status: 503, body: { error: "internal" } },
      { status: 200, body: { sources: [] } },
    ]);
    const api = new SundaySong({ fetch, sleep: noSleep });
    const res = await api.sources.list();
    expect(res.sources).toEqual([]);
    expect(calls).toHaveLength(2);
  });

  test("gives up after maxRetries and throws typed error", async () => {
    const { fetch, calls } = mockFetch([{ status: 429, body: { error: "rate_limited", message: "slow down" } }]);
    const api = new SundaySong({ fetch, sleep: noSleep, maxRetries: 1 });
    await expect(api.sources.list()).rejects.toBeInstanceOf(SundaySongError);
    expect(calls).toHaveLength(2); // initial + 1 retry
  });

  test("does not retry on 404", async () => {
    const { fetch, calls } = mockFetch([{ status: 404, body: { error: "not_found" } }]);
    const api = new SundaySong({ fetch, sleep: noSleep });
    await expect(api.songs.get("missing")).rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(calls).toHaveLength(1);
  });

  test("reportCsv returns raw text", async () => {
    const { fetch } = mockFetch([{ status: 200, body: undefined }]);
    // body undefined → empty string; assert it doesn't try to JSON-parse
    const api = new SundaySong({ fetch, sleep: noSleep });
    const csv = await api.licensing.reportCsv({ church_id: "c", from: "a", to: "b", system: "tono" });
    expect(typeof csv).toBe("string");
  });
});

/** A fetch mock that also records the request path + parsed JSON body. */
function recordingFetch(body: unknown) {
  const reqs: Array<{ url: string; method?: string; body: unknown }> = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    reqs.push({
      url: String(url),
      method: init?.method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, reqs };
}

describe("recommend namespace", () => {
  test("recommend.season POSTs the season body to /v1/recommend/season", async () => {
    const out: RecommendSeasonOutput = {
      season: "Advent",
      picks: [{ song_id: "s1", title: "O Come, O Come Emmanuel", score: 0.91, reason: "Advent longing." }],
      summary: "An Advent set anchored on expectation.",
    };
    const { fetch, reqs } = recordingFetch(out);
    const api = new SundaySong({ fetch, sleep: noSleep });

    const res = await api.recommend.season({ season: "Advent", limit: 1, language: "en" });

    expect(res).toEqual(out);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]!.url).toBe("https://api.sundaysong.com/v1/recommend/season");
    expect(reqs[0]!.method).toBe("POST");
    expect(reqs[0]!.body).toEqual({ season: "Advent", limit: 1, language: "en" });
  });

  test("recommend.after POSTs to /v1/recommend/after (mirrors season)", async () => {
    const out = { picks: [], from_key: "G", key_flow: true };
    const { fetch, reqs } = recordingFetch(out);
    const api = new SundaySong({ fetch, sleep: noSleep });

    const res = await api.recommend.after({ songId: "s1", limit: 5 });

    expect(res).toEqual(out);
    expect(reqs[0]!.url).toBe("https://api.sundaysong.com/v1/recommend/after");
    expect(reqs[0]!.body).toEqual({ songId: "s1", limit: 5 });
  });

  test("recommend() base call still POSTs to /v1/recommend", async () => {
    const out = { picks: [], total_minutes_estimate: 0, summary: "", reranked: false };
    const { fetch, reqs } = recordingFetch(out);
    const api = new SundaySong({ fetch, sleep: noSleep });

    await api.recommend({ theme: "grace" });

    expect(reqs[0]!.url).toBe("https://api.sundaysong.com/v1/recommend");
    expect(reqs[0]!.body).toEqual({ theme: "grace" });
  });
});

describe("usage.log wire contract", () => {
  // The route validates the body against `UsageEvent`, where `variant_id` and
  // `duration_displayed_sec` are `.nullable()` but NOT `.optional()` — the keys
  // must be present. The SDK type lets callers omit them; the SDK must therefore
  // send explicit `null`s, or the route rejects the request 400. These tests pin
  // that the emitted body actually parses against the real route schema.
  const valid = {
    church_id: "11111111-1111-1111-1111-111111111111",
    song_id: "22222222-2222-2222-2222-222222222222",
    service_date: "2026-01-04",
    was_streamed: true,
    idempotency_key: "svc-1:item-1",
  };

  test("fills variant_id + duration_displayed_sec with null when omitted", async () => {
    const { fetch, reqs } = recordingFetch({ ok: true, idempotency_key: valid.idempotency_key, logged: true });
    const api = new SundaySong({ fetch, sleep: noSleep });

    await api.usage.log(valid);

    expect(reqs[0]!.url).toBe("https://api.sundaysong.com/v1/usage/log");
    expect(reqs[0]!.method).toBe("POST");
    const body = reqs[0]!.body as Record<string, unknown>;
    expect(body.variant_id).toBeNull();
    expect(body.duration_displayed_sec).toBeNull();
    // The emitted body must satisfy the actual route validator (schema_version
    // defaults in, the nullable-required fields are present).
    expect(UsageEvent.safeParse(body).success).toBe(true);
  });

  test("preserves explicit variant_id + duration", async () => {
    const { fetch, reqs } = recordingFetch({ ok: true, idempotency_key: valid.idempotency_key, logged: true });
    const api = new SundaySong({ fetch, sleep: noSleep });

    await api.usage.log({
      ...valid,
      variant_id: "33333333-3333-3333-3333-333333333333",
      duration_displayed_sec: 240,
    });

    const body = reqs[0]!.body as Record<string, unknown>;
    expect(body.variant_id).toBe("33333333-3333-3333-3333-333333333333");
    expect(body.duration_displayed_sec).toBe(240);
    expect(UsageEvent.safeParse(body).success).toBe(true);
  });
});
