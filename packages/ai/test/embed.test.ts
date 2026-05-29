import { describe, expect, test } from "bun:test";
import { LocalEmbedder, EMBEDDING_DIM, cosine, tokenize, songEmbeddingText } from "../src/index";

const e = new LocalEmbedder();

describe("tokenize", () => {
  test("lowercases, keeps Nordic letters, drops punctuation + single chars", () => {
    expect(tokenize("Stor er du, Gud! Ærefrykt.")).toEqual(["stor", "er", "du", "gud", "ærefrykt"]);
  });
});

describe("LocalEmbedder", () => {
  test("is deterministic and the right width", async () => {
    const [a] = await e.embed(["amazing grace"]);
    const [b] = await e.embed(["amazing grace"]);
    expect(a).toHaveLength(EMBEDDING_DIM);
    expect(a).toEqual(b!);
  });

  test("vectors are L2-normalized", () => {
    const v = e.embedOne("grace and salvation and mercy");
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  test("similar texts are closer than dissimilar ones", () => {
    const grace = e.embedOne("grace salvation mercy forgiveness");
    const graceish = e.embedOne("salvation grace and mercy");
    const drums = e.embedOne("tempo drums rhythm percussion");
    expect(cosine(grace, graceish)).toBeGreaterThan(cosine(grace, drums));
  });

  test("empty text yields a zero vector (no NaNs)", () => {
    const v = e.embedOne("");
    expect(v.every((x) => x === 0)).toBe(true);
  });
});

describe("songEmbeddingText", () => {
  test("weaves title + themes + scripture", () => {
    const txt = songEmbeddingText(
      { canonical_title: "How Great Is Our God", themes: ["greatness", "worship"], bible_refs: ["Psalm 104:1"] },
      { composers: ["Chris Tomlin"] },
    );
    expect(txt).toContain("How Great Is Our God");
    expect(txt).toContain("greatness");
    expect(txt).toContain("Psalm 104:1");
    expect(txt).toContain("Chris Tomlin");
  });
});
