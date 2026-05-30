import { describe, expect, test } from "bun:test";
import {
  estimateCost,
  approxTokens,
  getLlmClient,
  AnthropicClient,
  DEFAULT_LLM_MODEL,
  CLAUDE_MODELS,
} from "../src/index";

describe("estimateCost", () => {
  test("prices input + output per the model table", () => {
    const cost = estimateCost("claude-sonnet-4-6", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(CLAUDE_MODELS["claude-sonnet-4-6"]!.inputPerMTok + CLAUDE_MODELS["claude-sonnet-4-6"]!.outputPerMTok);
  });

  test("unknown model falls back to Haiku pricing", () => {
    expect(estimateCost("made-up", 1_000_000, 0)).toBeCloseTo(CLAUDE_MODELS[DEFAULT_LLM_MODEL]!.inputPerMTok);
  });
});

describe("approxTokens", () => {
  test("~4 chars per token, rounded up", () => {
    expect(approxTokens("12345678")).toBe(2);
    expect(approxTokens("a")).toBe(1);
  });
});

describe("getLlmClient", () => {
  test("returns null when no key is configured (heuristic path)", () => {
    expect(getLlmClient({})).toBeNull();
  });

  test("returns a client honoring the model override", () => {
    const c = getLlmClient({ ANTHROPIC_API_KEY: "sk-test", SUNDAYSONG_LLM_MODEL: "claude-opus-4-8" });
    expect(c).not.toBeNull();
    expect(c!.model).toBe("claude-opus-4-8");
  });

  test("defaults to Haiku when no model override", () => {
    expect(getLlmClient({ ANTHROPIC_API_KEY: "sk-test" })!.model).toBe(DEFAULT_LLM_MODEL);
  });
});

describe("AnthropicClient.complete", () => {
  test("posts to the Messages API and joins text blocks", async () => {
    let captured: { url: string; body: any } | null = null;
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), body: JSON.parse(String(init?.body)) };
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: "Hello " }, { type: "text", text: "world" }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const client = new AnthropicClient({ apiKey: "sk-x", model: "claude-haiku-4-5-20251001", fetchImpl: fakeFetch });
    const out = await client.complete([{ role: "user", content: "hi" }], { system: "be brief", maxTokens: 10 });

    expect(out).toBe("Hello world");
    expect(captured!.url).toContain("api.anthropic.com");
    expect(captured!.body.model).toBe("claude-haiku-4-5-20251001");
    expect(captured!.body.system).toBe("be brief");
    expect(captured!.body.max_tokens).toBe(10);
    expect(captured!.body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  test("throws on a non-2xx response", async () => {
    const fakeFetch = (async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch;
    const client = new AnthropicClient({ apiKey: "sk-x", fetchImpl: fakeFetch });
    await expect(client.complete([{ role: "user", content: "hi" }])).rejects.toThrow("429");
  });
});
