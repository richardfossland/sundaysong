/**
 * Admin API client — a thin, typed wrapper over the internal moderation +
 * oversight endpoints the admin dashboard consumes (Phase 8 / Phase 9).
 *
 * These routes are behind the Sunday JWT (the `churchScoped`/admin guard wired
 * in the API). The client mirrors the public `@sundaysong/sdk` shape: a single
 * injectable `fetch` so integration tests can mock every response with no
 * network — the same dependency-injection seam the recommend/usage route tests
 * use. The base URL resolves to the internal API host server-side.
 */

import type { ModerationAction, UploadRecord, UploadStatus } from "./moderation";

export interface AdminClientConfig {
  /** Internal API base. Defaults to the public host; override per-environment. */
  baseUrl?: string;
  /** Admin bearer token (a Sunday JWT with the admin scope). */
  token?: string;
  /** Fetch override for tests / non-browser runtimes. */
  fetch?: typeof globalThis.fetch;
}

export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.code = code;
  }
}

/** A single source-sync run as reported by the connectors pipeline. */
export interface SourceSyncRun {
  source_id: string;
  source_name: string;
  started_at: string;
  finished_at: string | null;
  status: "ok" | "partial" | "failed" | "running";
  rows_in: number;
  rows_upserted: number;
  errors: string[];
}

/** Coverage / search-volume analytics for the beta dashboard. */
export interface AnalyticsSummary {
  /** Top search queries by volume over the window. */
  top_queries: Array<{ query: string; count: number; zero_results: boolean }>;
  /** Queries that returned nothing — the coverage gaps to fill. */
  coverage_gaps: Array<{ query: string; count: number }>;
  total_searches: number;
  catalog_size: number;
}

export interface ModerateResult {
  upload_id: string;
  status: UploadStatus;
}

export class AdminClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(config: AdminClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? "https://api.sundaysong.com").replace(/\/$/, "");
    this.token = config.token;
    this.fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchImpl(this.baseUrl + path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      let body: { error?: string; message?: string } = {};
      try {
        body = (await res.json()) as { error?: string; message?: string };
      } catch {
        /* non-JSON error body */
      }
      throw new AdminApiError(res.status, body.error ?? `http_${res.status}`, body.message ?? res.statusText);
    }
    return (await res.json()) as T;
  }

  /** Pending + recently-moderated user uploads, optionally filtered by status. */
  listUploads(status?: UploadStatus): Promise<{ uploads: UploadRecord[] }> {
    const q = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.request(`/v1/admin/uploads${q}`);
  }

  /** Approve / reject / request-changes on one upload. */
  moderateUpload(uploadId: string, action: ModerationAction, note?: string): Promise<ModerateResult> {
    return this.request(`/v1/admin/uploads/${encodeURIComponent(uploadId)}/moderate`, {
      method: "POST",
      body: JSON.stringify({ action, note }),
    });
  }

  /** Source sync history — status, row counts, error logs per run. */
  listSyncRuns(): Promise<{ runs: SourceSyncRun[] }> {
    return this.request("/v1/admin/sources/sync-runs");
  }

  /** Search-volume + coverage-gap analytics for the beta dashboard. */
  analytics(): Promise<AnalyticsSummary> {
    return this.request("/v1/admin/analytics");
  }
}
