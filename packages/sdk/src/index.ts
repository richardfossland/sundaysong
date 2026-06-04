/**
 * `@sundaysong/sdk` — official TypeScript client.
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
  SongSection,
  NordicMetadata,
  SearchHit,
  RecommendInput,
  RecommendOutput,
  RecommendAfterInput,
  RecommendAfterOutput,
  LicensingReport,
  TranslateInput,
  TranslationDraftResult,
} from "@sundaysong/shared";

export interface ClientConfig {
  /** Where the API lives. Defaults to https://api.sundaysong.com */
  baseUrl?: string;
  /** Bearer API key (Phase 5.1 issues these). */
  apiKey?: string;
  /** Optional fetch override for tests / non-browser runtimes. */
  fetch?: typeof globalThis.fetch;
  /** Retries on 429/5xx with exponential backoff (honors Retry-After). Default 2. */
  maxRetries?: number;
  /** Sleep override for tests (defaults to setTimeout). */
  sleep?: (ms: number) => Promise<void>;
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

const RETRYABLE = (status: number) => status === 429 || status >= 500;

export class SundaySong {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(config: ClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? "https://api.sundaysong.com").replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.maxRetries = config.maxRetries ?? 2;
    this.sleep = config.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Fetch with retry on transient failures; throws SundaySongError on a final non-2xx. */
  private async send(path: string, init?: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(this.baseUrl + path, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          ...(init?.headers ?? {}),
        },
      });
      if (res.ok) return res;
      if (RETRYABLE(res.status) && attempt < this.maxRetries) {
        const ra = Number(res.headers.get("retry-after"));
        const delay = Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(2000, 250 * 2 ** attempt);
        await this.sleep(delay);
        continue;
      }
      let body: { error?: string; message?: string } = {};
      try { body = await res.json() as { error?: string; message?: string }; } catch {}
      throw new SundaySongError(res.status, body.error ?? `http_${res.status}`, body.message ?? res.statusText);
    }
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    return await (await this.send(path, init)).json() as T;
  }

  private async requestText(path: string, init?: RequestInit): Promise<string> {
    return await (await this.send(path, init)).text();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  readonly songs = {
    search: (params: SearchParams): Promise<SongSearchResult> => {
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
    get: (id: string): Promise<SongDetail> =>
      this.request(`/v1/songs/${encodeURIComponent(id)}`),
    /** Contribute a song (Phase 8.1) — requires `license_declaration: true`. */
    upload: (input: SongUploadInput): Promise<{ song_id: string; variant_id: string; action: "added" | "updated" }> =>
      this.request("/v1/songs", { method: "POST", body: JSON.stringify(input) }),
    /** AI translation draft (Phase 4.2, Sunday Pro) — PD or your own upload only. */
    translate: (input: TranslateInput): Promise<TranslationDraftResult> =>
      this.request("/v1/songs/translate", { method: "POST", body: JSON.stringify(input) }),
  };

  readonly recommend = Object.assign(
    (input: RecommendInput): Promise<RecommendOutput> =>
      this.request("/v1/recommend", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    {
      /**
       * Use case B — "songs that flow well after song X".
       * Ranks the catalog by circle-of-fifths key compatibility + BPM proximity.
       * Pure music-theory; no LLM required.
       */
      after: (input: RecommendAfterInput): Promise<RecommendAfterOutput> =>
        this.request("/v1/recommend/after", {
          method: "POST",
          body: JSON.stringify(input),
        }),
    },
  );

  /** Instant transposition — re-key chords or a ChordPro chart. */
  readonly transpose = (input: TransposeInput): Promise<TransposeResult> =>
    this.request("/v1/transpose", {
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

  /** The data sources we index, with per-source variant counts. */
  readonly sources = {
    list: (): Promise<{ sources: SourceSummary[] }> => this.request("/v1/sources"),
  };

  readonly licensing = {
    report: (input: { church_id: string; from: string; to: string }): Promise<LicensingReport> =>
      this.request("/v1/licensing/report", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    /** Downloadable CSV for one licensor — returns the raw CSV text. */
    reportCsv: (input: { church_id: string; from: string; to: string; system: "ccli" | "tono" }): Promise<string> =>
      this.requestText(`/v1/licensing/report.csv?system=${input.system}`, {
        method: "POST",
        body: JSON.stringify({ church_id: input.church_id, from: input.from, to: input.to }),
      }),
    /** Per-song CCLI/TONO coverage for the song pill. */
    coverage: (input: CoverageInput): Promise<SongCoverageResult> =>
      this.request("/v1/licensing/coverage", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  };

  /** Cross-language translation matching (Phase 3.3). */
  readonly matching = {
    score: (input: { a: MatchSongInput; b: MatchSongInput }): Promise<CandidateScoreResult> =>
      this.request("/v1/matching/score", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    candidates: (input: { target: MatchSongInput; pool: MatchSongInput[]; min_confidence?: number }):
      Promise<{ target_id: string; candidates: CandidateScoreResult[] }> =>
      this.request("/v1/matching/candidates", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  };
}

export type MusicDialect = "international" | "german";

export interface TransposeInput {
  /** Provide exactly one of `chords` or `chordpro`. */
  chords?: string[];
  chordpro?: string;
  from_key: string;
  /** Provide either `to_key` or `semitones`. */
  to_key?: string;
  semitones?: number;
  dialect?: MusicDialect;
  /** Also return Nashville numbers for the source chords. */
  nashville?: boolean;
  /** Also return capo suggestions for the target key. */
  capo?: boolean;
}

export interface CapoSuggestion {
  capo: number;
  playAs: string;
}

export interface TransposeResult {
  from_key: string;
  to_key: string;
  semitones: number;
  chords?: string[];
  chordpro?: string;
  nashville?: Array<string | null>;
  capo?: CapoSuggestion[];
}

export type CoverageStatus =
  | "covered"
  | "not_covered"
  | "unknown"
  | "not_required"
  | "foreign_reciprocal";

export interface CoverageInput {
  song: {
    id: string;
    canonical_title: string;
    copyright_status: "public_domain" | "copyrighted" | "unknown";
    ccli_song_id?: string | null;
    tono_work_id?: string | null;
    tono_registered?: boolean;
    nordic_metadata?: { copyright_status_no?: "public_domain" | "copyrighted" | "unknown" };
  };
  profile: {
    church_id: string;
    ccli_license_number?: string | null;
    ccli_size_category?: "A" | "B" | "C" | "D" | "E" | "F" | null;
    ccli_streaming_addon: boolean;
    tono_license_status:
      | "none"
      | "state_church_blanket"
      | "direct_agreement"
      | "application_pending"
      | "not_applicable";
    tono_customer_id?: string | null;
    tono_streaming_addon: boolean;
    denomination: "den_norske_kirke" | "frikirke" | "pinse" | "baptist" | "metodist" | "other";
  };
}

export interface SongCoverageResult {
  song_id: string;
  ccli_status: CoverageStatus;
  tono_status: CoverageStatus;
  gray_areas: string[];
}

export interface MatchSongInput {
  id: string;
  canonical_title: string;
  language: string;
  themes?: string[];
  bible_refs?: string[];
  year_first_published?: number | null;
  composer_ids?: string[];
  ccli_song_id?: string | null;
  tono_work_id?: string | null;
}

export interface CandidateScoreResult {
  a_id: string;
  b_id: string;
  confidence: number;
  recommendation: "auto_link" | "propose" | "reject";
  signals: Array<{ name: string; weight: number; detail?: string }>;
}

export interface SearchParams {
  q: string;
  language?: string;
  page?: number;
  page_size?: number;
}

export interface SongUploadInput {
  title: string;
  language: string;
  year_first_published?: number | null;
  copyright_status?: "public_domain" | "copyrighted" | "unknown";
  lyricists?: string[];
  themes?: string[];
  bible_refs?: string[];
  key?: string | null;
  lyrics_excerpt?: string | null;
  lyrics_url?: string | null;
  chord_chart_url?: string | null;
  /** Must be true — "I have the right to share this." */
  license_declaration: true;
}

export interface SourceSummary {
  id: string;
  name: string;
  kind: "api" | "scrape" | "manual" | "user_upload";
  attribution_template: string;
  enabled: boolean;
  variant_count: number;
}

/** Which engine answered a search — Meilisearch, or the trigram fallback when it's down. */
export type SearchEngine = "meilisearch" | "postgres_fallback";

export interface SongSearchResult {
  hits: SearchHit[];
  total: number;
  page: number;
  page_size: number;
  engine: SearchEngine;
}

/** A credited writer linked to a song (Phase 1.2 person linking). */
export interface Lyricist {
  id: string;
  display_name: string;
}

/** A song in another language linked to this one (Phase 3.3 cross-language). */
export interface TranslationLink {
  song_id: string;
  title: string;
  language: string;
  relationship: "official" | "unofficial" | "adaptation" | "paraphrase";
  attribution: string | null;
  direction: "to" | "from";
}

/** `GET /v1/songs/:id` — the full song with its variants, writers and translations. */
export type SongDetail = Song & {
  variants: SongVariant[];
  lyricists: Lyricist[];
  translations: TranslationLink[];
};

export interface UsageLogPayload {
  church_id: string;
  song_id: string;
  variant_id?: string | null;
  service_date: string;
  duration_displayed_sec?: number | null;
  was_streamed: boolean;
  idempotency_key: string;
}

export type { Song, SongVariant, SearchHit, RecommendInput, RecommendOutput, RecommendAfterInput, RecommendAfterOutput, LicensingReport, SongSection, NordicMetadata, TranslateInput, TranslationDraftResult };
