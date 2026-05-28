import { describe, expect, test } from "bun:test";
import { SalmebokConnector, SALMEBOK_CATALOG_SIZE } from "../src/sources/salmebok";

describe("SalmebokConnector", () => {
  test("discover pages through the whole catalog with no dupes", async () => {
    const c = new SalmebokConnector({ pageSize: 5 });
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await c.discover(cursor);
      ids.push(...page.externalIds);
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    expect(ids).toHaveLength(SALMEBOK_CATALOG_SIZE);
    expect(new Set(ids).size).toBe(SALMEBOK_CATALOG_SIZE);
  });

  test("normalize maps a hymn to a public-domain NormalizedSong", async () => {
    const c = new SalmebokConnector();
    const doc = c.normalize(await c.fetch("blix-no-livnar-det-i-lundar"));
    expect(doc).toMatchObject({
      source: "salmebok",
      source_external_id: "blix-no-livnar-det-i-lundar",
      canonical_title: "No livnar det i lundar",
      original_language: "nn",
      copyright_status: "public_domain",
    });
    expect(doc.variant.attribution_text).toContain("Elias Blix");
    expect(doc.themes).toContain("vår");
  });

  test("every hymn in the catalog is public domain", async () => {
    const c = new SalmebokConnector({ pageSize: 100 });
    const { externalIds } = await c.discover();
    for (const id of externalIds) {
      expect(c.normalize(await c.fetch(id)).copyright_status).toBe("public_domain");
    }
  });

  test("fetch throws a permanent 404 for unknown ids", async () => {
    await expect(new SalmebokConnector().fetch("nope")).rejects.toThrow("unknown salme");
  });
});
