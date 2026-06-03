/**
 * Integration tests for the admin API client.
 *
 * Offline — no network. We inject a mock `fetch` (the same dependency-injection
 * seam the public SDK + the route tests use) so every `/v1/admin/*` response is
 * a deterministic fixture. We assert the request shape (method, URL, auth
 * header, body) and the typed response mapping, plus the structured error
 * envelope on a non-2xx.
 */

import { describe, expect, test } from "bun:test";

import { AdminApiError, AdminClient } from "../src/lib/adminClient";
import type { SourceSyncRun, AnalyticsSummary } from "../src/lib/adminClient";
import type { UploadRecord } from "../src/lib/moderation";

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Build a mock fetch that records calls and replies with `reply` per call. */
function mockFetch(reply: (req: Recorded) => { status?: number; json: unknown }) {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(
      Object.entries((init?.headers as Record<string, string>) ?? {}),
    );
    const rec: Recorded = {
      url,
      method: init?.method ?? "GET",
      headers,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(rec);
    const { status = 200, json } = reply(rec);
    return new Response(JSON.stringify(json), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
  return { fetchImpl, calls };
}

const upload = (over: Partial<UploadRecord> & { id: string }): UploadRecord => ({
  song_id: "song-" + over.id,
  title: over.id,
  language: "no",
  submitted_by: "leader@church.no",
  submitted_at: "2026-01-01T00:00:00.000Z",
  status: "pending",
  copyright_status: "public_domain",
  ...over,
});

describe("AdminClient.listUploads", () => {
  test("GETs the queue and passes the bearer token", async () => {
    const { fetchImpl, calls } = mockFetch(() => ({ json: { uploads: [upload({ id: "u1" })] } }));
    const client = new AdminClient({ baseUrl: "http://api", token: "jwt-123", fetch: fetchImpl });

    const { uploads } = await client.listUploads();

    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.id).toBe("u1");
    expect(calls[0]!.url).toBe("http://api/v1/admin/uploads");
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.headers.Authorization).toBe("Bearer jwt-123");
  });

  test("encodes the status filter into the query string", async () => {
    const { fetchImpl, calls } = mockFetch(() => ({ json: { uploads: [] } }));
    const client = new AdminClient({ baseUrl: "http://api", fetch: fetchImpl });

    await client.listUploads("changes_requested");

    expect(calls[0]!.url).toBe("http://api/v1/admin/uploads?status=changes_requested");
    // No token configured → no Authorization header.
    expect(calls[0]!.headers.Authorization).toBeUndefined();
  });
});

describe("AdminClient.moderateUpload", () => {
  test("POSTs the action + note to the moderate endpoint", async () => {
    const { fetchImpl, calls } = mockFetch((req) => ({
      json: { upload_id: "u1", status: req.body && (req.body as { action: string }).action === "approve" ? "approved" : "pending" },
    }));
    const client = new AdminClient({ baseUrl: "http://api", token: "jwt", fetch: fetchImpl });

    const res = await client.moderateUpload("u1", "approve");

    expect(res.status).toBe("approved");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("http://api/v1/admin/uploads/u1/moderate");
    expect(calls[0]!.body).toEqual({ action: "approve", note: undefined });
  });

  test("forwards the moderator note and url-encodes the id", async () => {
    const { fetchImpl, calls } = mockFetch(() => ({ json: { upload_id: "a/b", status: "rejected" } }));
    const client = new AdminClient({ baseUrl: "http://api", fetch: fetchImpl });

    await client.moderateUpload("a/b", "reject", "duplicate of #42");

    expect(calls[0]!.url).toBe("http://api/v1/admin/uploads/a%2Fb/moderate");
    expect(calls[0]!.body).toEqual({ action: "reject", note: "duplicate of #42" });
  });
});

describe("AdminClient.listSyncRuns", () => {
  test("maps the sync-run history", async () => {
    const run: SourceSyncRun = {
      source_id: "hymnary",
      source_name: "Hymnary.org",
      started_at: "2026-01-01T10:00:00.000Z",
      finished_at: "2026-01-01T10:01:00.000Z",
      status: "partial",
      rows_in: 100,
      rows_upserted: 97,
      errors: ["row 12: missing title", "row 88: bad year"],
    };
    const { fetchImpl, calls } = mockFetch(() => ({ json: { runs: [run] } }));
    const client = new AdminClient({ baseUrl: "http://api", fetch: fetchImpl });

    const { runs } = await client.listSyncRuns();

    expect(calls[0]!.url).toBe("http://api/v1/admin/sources/sync-runs");
    expect(runs[0]!.status).toBe("partial");
    expect(runs[0]!.errors).toHaveLength(2);
  });
});

describe("AdminClient.analytics", () => {
  test("maps the analytics summary", async () => {
    const summary: AnalyticsSummary = {
      top_queries: [{ query: "nåde", count: 120, zero_results: false }],
      coverage_gaps: [{ query: "obscure carol", count: 4 }],
      total_searches: 5000,
      catalog_size: 1200,
    };
    const { fetchImpl } = mockFetch(() => ({ json: summary }));
    const client = new AdminClient({ baseUrl: "http://api", fetch: fetchImpl });

    const res = await client.analytics();

    expect(res.total_searches).toBe(5000);
    expect(res.coverage_gaps[0]!.query).toBe("obscure carol");
  });
});

describe("AdminClient — error handling", () => {
  test("throws a structured AdminApiError on a non-2xx", async () => {
    const { fetchImpl } = mockFetch(() => ({ status: 403, json: { error: "forbidden", message: "Admin scope required." } }));
    const client = new AdminClient({ baseUrl: "http://api", fetch: fetchImpl });

    try {
      await client.listUploads();
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AdminApiError);
      const err = e as AdminApiError;
      expect(err.status).toBe(403);
      expect(err.code).toBe("forbidden");
      expect(err.message).toBe("Admin scope required.");
    }
  });

  test("falls back to http_<status> when the body is not JSON", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 500 })) as unknown as typeof globalThis.fetch;
    const client = new AdminClient({ baseUrl: "http://api", fetch: fetchImpl });

    try {
      await client.analytics();
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AdminApiError);
      expect((e as AdminApiError).status).toBe(500);
      expect((e as AdminApiError).code).toBe("http_500");
    }
  });
});
