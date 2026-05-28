import { describe, expect, test } from "bun:test";
import { TestConnector, TEST_CATALOG_SIZE } from "../src/testConnector";

describe("TestConnector", () => {
  test("discover pages through the whole catalog", async () => {
    const c = new TestConnector({ pageSize: 4 });
    const ids: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await c.discover(cursor);
      ids.push(...page.externalIds);
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== undefined);
    expect(ids).toHaveLength(TEST_CATALOG_SIZE);
    expect(new Set(ids).size).toBe(TEST_CATALOG_SIZE); // no dupes
    expect(pages).toBe(3); // 10 items / page 4
  });

  test("fetch + normalize maps source shape to our schema", async () => {
    const c = new TestConnector();
    const normalized = c.normalize(await c.fetch("t3"));
    expect(normalized).toMatchObject({
      source: "test",
      source_external_id: "t3",
      canonical_title: "How Great Is Our God",
      original_language: "en",
      copyright_status: "copyrighted",
      ccli_song_id: "4348399",
      tono_work_id: "T-1002",
    });
    expect(normalized.variant.attribution_text).toContain("Test data");
  });

  test("public-domain song maps copyright_status", async () => {
    const c = new TestConnector();
    const n = c.normalize(await c.fetch("t1"));
    expect(n.copyright_status).toBe("public_domain");
    expect(n.ccli_song_id).toBeUndefined();
  });

  test("fetch throws a permanent 404 for injected failures", async () => {
    const c = new TestConnector({ failPermanent: ["t6"] });
    await expect(c.fetch("t6")).rejects.toThrow("not found");
  });
});
