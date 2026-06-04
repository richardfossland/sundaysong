import { describe, expect, test } from "bun:test";
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
