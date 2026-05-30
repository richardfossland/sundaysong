/**
 * LLM client (Anthropic) for SundaySong's AI features.
 *
 * Same shape as `getEmbedder()`: the *pure* logic (prompt building, response
 * parsing, grounding) lives next to this and stays testable offline, while the
 * network call sits behind a configured key. `getLlmClient()` returns `null`
 * when no key is present, and every caller must degrade gracefully to its
 * heuristic path — so the free tier keeps working with no key, and Sunday Pro
 * layers the LLM on top (see CLAUDE.md: "AI features run server-side via
 * Anthropic API").
 *
 * Deliberately dependency-free: we `fetch` the Messages API directly rather
 * than pull the SDK, matching the local-embedder choice in `embed.ts`. Swap in
 * the official SDK later without touching callers — the `LlmClient` interface
 * is the seam.
 */

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmCompleteOptions {
  system?: string;
  /** Hard cap on output tokens. Defaults to 1024. */
  maxTokens?: number;
  /** 0..1. Recommendation re-ranking wants low temperature for stable order. */
  temperature?: number;
}

export interface LlmClient {
  readonly model: string;
  /** Returns the assistant's text. Throws on transport/API error — callers fall back. */
  complete(messages: LlmMessage[], opts?: LlmCompleteOptions): Promise<string>;
}

/** Per-1M-token USD pricing, for the pure cost estimate (no network). */
export interface ClaudeModel {
  readonly id: string;
  readonly label: string;
  readonly inputPerMTok: number;
  readonly outputPerMTok: number;
}

export const CLAUDE_MODELS: Record<string, ClaudeModel> = {
  "claude-haiku-4-5-20251001": { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", inputPerMTok: 1, outputPerMTok: 5 },
  "claude-sonnet-4-6": { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", inputPerMTok: 3, outputPerMTok: 15 },
  "claude-opus-4-8": { id: "claude-opus-4-8", label: "Claude Opus 4.8", inputPerMTok: 15, outputPerMTok: 75 },
};

/** Cheapest capable model — the default for high-volume re-ranking. */
export const DEFAULT_LLM_MODEL = "claude-haiku-4-5-20251001";

/** Pure: estimate USD cost for a call. Unknown models fall back to Haiku pricing. */
export function estimateCost(modelId: string, inputTokens: number, outputTokens: number): number {
  const m = CLAUDE_MODELS[modelId] ?? CLAUDE_MODELS[DEFAULT_LLM_MODEL]!;
  return (inputTokens / 1_000_000) * m.inputPerMTok + (outputTokens / 1_000_000) * m.outputPerMTok;
}

/** Rough token count (~4 chars/token) for the pre-flight cost estimate. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export class AnthropicClient implements LlmClient {
  readonly model: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { apiKey: string; model?: string; fetchImpl?: typeof fetch }) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_LLM_MODEL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async complete(messages: LlmMessage[], opts: LlmCompleteOptions = {}): Promise<string> {
    const res = await this.fetchImpl(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0,
        ...(opts.system ? { system: opts.system } : {}),
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 500)}`);
    }

    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    return (data.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("")
      .trim();
  }
}

/**
 * The active LLM client, or `null` when no key is configured. Reads from the
 * passed env (defaults to `process.env`) so callers can inject in tests.
 *   ANTHROPIC_API_KEY    — required to enable; absent ⇒ null (heuristic path).
 *   SUNDAYSONG_LLM_MODEL — optional model override.
 */
export function getLlmClient(env: Record<string, string | undefined> = process.env): LlmClient | null {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new AnthropicClient({ apiKey, model: env.SUNDAYSONG_LLM_MODEL });
}
