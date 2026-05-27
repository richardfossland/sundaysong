/**
 * `@sunday/song-sdk` — official TypeScript client.
 *
 * Used by SundayStage, SundayPlan, sundaysong.com, and any third-party
 * integration. Wraps the public REST API with typed methods, helpful
 * errors, and pagination helpers.
 *
 * Phase 5.2 fleshes this out with retries, streaming for AI endpoints,
 * React hook helpers, etc. For now, the contract is here so consumers
 * can compile against it.
 */

import type {
  Song,
  SongVariant,
  SearchHit,
  RecommendInput,
  RecommendOutput,
  LicensingReport,
} from "@sundaysong/shared";

export interface ClientConfig {
  /** Where the API lives. Defaults to https://api.sundaysong.com */
  baseUrl?: string;
  /** Bearer API key (Phase 5.1 issues these). */
  apiKey?: string;
  /** Optional fetch override for tests / non-browser runtimes. */
  fetch?: typeof globalThis.fetch;
}

export class SundaySongError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "SundaySongError";
    this.status = status;
    this.code = code;
  }
}

export class SundaySong {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(config: ClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? "https://api.sundaysong.com").replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchImpl(this.baseUrl + path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      let body: { error?: string; message?: string } = {};
      try { body = await res.json() as { error?: string; message?: string }; } catch {}
      throw new SundaySongError(
        res.status,
        body.error ?? `http_${res.status}`,
        body.message ?? res.statusText,
      );
    }
    return await res.json() as T;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  readonly songs = {
    search: (params: SearchParams): Promise<{ hits: SearchHit[]; total: number }> => {
      const u = new URLSearchParams();
      u.set("q", params.q);
      if (params.language) u.set("language", params.language);
      if (params.page !== undefined) u.set("page", String(params.page));
      if (params.page_size !== undefined) u.set("page_size", String(params.page_size));
      return this.request(`/v1/songs/search?${u.toString()}`);
    },
    semanticSearch: (body: { query: string; language?: string }) =>
      this.request<{ hits: SearchHit[] }>("/v1/songs/semantic-search", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    get: (id: string): Promise<Song & { variants: SongVariant[] }> =>
      this.request(`/v1/songs/${encodeURIComponent(id)}`),
  };

  readonly recommend = (input: RecommendInput): Promise<RecommendOutput> =>
    this.request("/v1/recommend", {
      method: "POST",
      body: JSON.stringify(input),
    });

  readonly usage = {
    log: (row: UsageLogPayload) =>
      this.request<{ ok: true; idempotency_key: string }>("/v1/usage/log", {
        method: "POST",
        body: JSON.stringify(row),
      }),
  };

  readonly licensing = {
    report: (input: { church_id: string; from: string; to: string }): Promise<LicensingReport> =>
      this.request("/v1/licensing/report", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  };
}

export interface SearchParams {
  q: string;
  language?: string;
  page?: number;
  page_size?: number;
}

export interface UsageLogPayload {
  church_id: string;
  song_id: string;
  variant_id?: string | null;
  service_date: string;
  duration_displayed_sec?: number | null;
  was_streamed: boolean;
  idempotency_key: string;
}

export type { Song, SongVariant, SearchHit, RecommendInput, RecommendOutput, LicensingReport };
