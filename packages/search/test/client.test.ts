/**
 * Meili client integration test — runs against the live Meilisearch from
 * `pnpm db:up`. Uses a unique throwaway index that it deletes afterwards, so it
 * never disturbs the real `songs` index.
 *
 * Offline (no Meilisearch reachable) the whole suite is skipped with a clear
 * message instead of throwing raw ConnectionRefused stacks, so `pnpm -r test`
 * stays green for local dev without Docker. CI provides the service, so the
 * tests run there. Set SUNDAYSONG_REQUIRE_SERVICES=1 to fail (not skip) when
 * the service is unreachable.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { MeiliClient } from "../src/client";
import { reindexSongs } from "../src/reindex";
import type { SongDoc } from "../src/songDoc";

const meili = new MeiliClient();
const INDEX = `test_songs_${Date.now()}`;

const MEILI_HOST = process.env.MEILI_HOST ?? "http://localhost:7700";
const reachable = await fetch(`${MEILI_HOST}/health`, {
  signal: AbortSignal.timeout(1500),
})
  .then((r) => r.ok)
  .catch(() => false);

if (!reachable) {
  if (process.env.SUNDAYSONG_REQUIRE_SERVICES === "1") {
    throw new Error(`Meilisearch not reachable at ${MEILI_HOST} but SUNDAYSONG_REQUIRE_SERVICES=1`);
  }
  console.warn(`[search] Meilisearch not reachable at ${MEILI_HOST} — skipping live integration tests (run \`pnpm db:up\`).`);
}

const DOCS: SongDoc[] = [
  { id: "a", canonical_title: "Amazing Grace", titles: ["Amazing Grace"], languages: ["en"], themes: ["grace"], bible_refs: [], copyright_status: "public_domain", tono_work_id: null, ccli_song_id: null, popularity_score: 5 },
  { id: "b", canonical_title: "Deg være ære", titles: ["Deg være ære"], languages: ["no"], themes: ["påske"], bible_refs: [], copyright_status: "public_domain", tono_work_id: "T-1", ccli_song_id: null, popularity_score: 9 },
];

describe.skipIf(!reachable)("MeiliClient (live)", () => {
  beforeAll(async () => {
    await reindexSongs(meili, DOCS, INDEX);
  });

  afterAll(async () => {
    await meili.deleteIndex(INDEX);
  });

  test("full-text search finds a song by title", async () => {
    const res = await meili.search<SongDoc>(INDEX, { q: "grace" });
    expect(res.hits.map((h) => h.id)).toContain("a");
  });

  test("language filter narrows results", async () => {
    const res = await meili.search<SongDoc>(INDEX, { q: "", filter: 'languages = "no"', limit: 50 });
    const ids = res.hits.map((h) => h.id);
    expect(ids).toContain("b");
    expect(ids).not.toContain("a");
  });

  test("typo tolerance still matches", async () => {
    const res = await meili.search<SongDoc>(INDEX, { q: "amazin" });
    expect(res.hits.map((h) => h.id)).toContain("a");
  });
});
