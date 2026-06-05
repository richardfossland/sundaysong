/**
 * Pagination bound on `SongSearchQuerySchema` (security / DoS).
 *
 * The search route computes the engine offset as `page * page_size`. `page_size`
 * is capped at 100, but `page` had no upper bound, so a single request like
 * `page=1_000_000&page_size=100` asked for offset 100_000_000. On the Meili path
 * that blows past Meilisearch's hard 10_000 `offset` ceiling (the request errors
 * and trips the fallback); on the Postgres fallback it turns into a deep
 * `OFFSET 100000000` scan — wasted work an unauthenticated caller can trigger at
 * will. The schema must reject any window whose final offset exceeds the engine
 * offset cap, BEFORE any infra is touched.
 */

import { describe, expect, test } from "bun:test";

import { SongSearchQuerySchema, SEARCH_MAX_OFFSET } from "../src/schemas";

describe("SongSearchQuerySchema — pagination offset bound", () => {
  test("rejects a page whose offset exceeds the engine offset cap", () => {
    // The historical DoS input: offset = 1_000_000 * 100 = 100_000_000.
    const r = SongSearchQuerySchema.safeParse({ q: "grace", page: "1000000", page_size: "100" });
    expect(r.success).toBe(false);
  });

  test("rejects the smallest over-cap window (offset just past the cap)", () => {
    // page_size 100 → page 100 is offset 10_000 (exactly the cap, allowed); the
    // first window that clears it is page 101 (offset 10_100).
    const justOver = SongSearchQuerySchema.safeParse({ q: "grace", page: "101", page_size: "100" });
    expect(justOver.success).toBe(false);

    const atCap = SongSearchQuerySchema.safeParse({ q: "grace", page: "100", page_size: "100" });
    expect(atCap.success).toBe(true);
  });

  test("the offset cap matches Meilisearch's hard ceiling (10_000)", () => {
    expect(SEARCH_MAX_OFFSET).toBe(10_000);
  });

  test("an offset exactly at the cap is allowed (deepest legal page)", () => {
    // 10_000 / 50 = page 200 → offset exactly 10_000, the deepest legal window.
    const r = SongSearchQuerySchema.safeParse({ q: "grace", page: "200", page_size: "50" });
    expect(r.success).toBe(true);
  });

  test("ordinary paging is unaffected", () => {
    const r = SongSearchQuerySchema.safeParse({ q: "grace", page: "2", page_size: "20" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.page * r.data.page_size).toBe(40);
  });

  test("defaults (page 0, page_size 20) still parse", () => {
    const r = SongSearchQuerySchema.safeParse({ q: "grace" });
    expect(r.success).toBe(true);
    if (r.success) expect({ page: r.data.page, page_size: r.data.page_size }).toEqual({ page: 0, page_size: 20 });
  });
});
