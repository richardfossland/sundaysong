import { describe, expect, test } from "bun:test";
import {
  foldNordic,
  tokenize,
  titleMatchScore,
  docTitleScore,
  rankScore,
  rankDocs,
} from "../src/ranking";
import type { SongDoc } from "../src/songDoc";

function doc(overrides: Partial<SongDoc> = {}): SongDoc {
  return {
    id: "s1",
    canonical_title: "How Great Is Our God",
    titles: ["How Great Is Our God"],
    languages: ["en"],
    themes: [],
    bible_refs: [],
    copyright_status: "copyrighted",
    tono_work_id: null,
    ccli_song_id: null,
    popularity_score: 0,
    ...overrides,
  };
}

describe("foldNordic", () => {
  test("lowercases and drops combining diacritics", () => {
    expect(foldNordic("Café")).toBe("cafe");
    expect(foldNordic("Über")).toBe("uber");
  });
  test("folds the Nordic special letters to base forms", () => {
    expect(foldNordic("Når mitt øye")).toBe("nar mitt oye");
    expect(foldNordic("Härlig är")).toBe("harlig ar"); // ä via NFD
    expect(foldNordic("Frälsare")).toBe("fralsare");
    expect(foldNordic("Kjærlighet")).toBe("kjaerlighet"); // æ→ae
  });
});

describe("tokenize", () => {
  test("splits on non-alphanumerics after folding", () => {
    expect(tokenize("Blott en dag, ett ögonblick")).toEqual([
      "blott",
      "en",
      "dag",
      "ett",
      "ogonblick",
    ]);
  });
});

describe("titleMatchScore", () => {
  test("exact match scores 1", () => {
    expect(titleMatchScore("Amazing Grace", "amazing grace")).toBe(1);
  });
  test("accent/keyboard differences never cost a tier (exact after folding)", () => {
    expect(titleMatchScore("nar mitt oye", "Når mitt øye")).toBe(1);
  });
  test("prefix scores 0.9", () => {
    expect(titleMatchScore("blott en dag", "Blott en dag, ett ögonblick i sänder")).toBe(0.9);
  });
  test("all tokens present in order scores 0.8", () => {
    expect(titleMatchScore("great god", "How Great Is Our God")).toBe(0.8);
  });
  test("all tokens present out of order scores 0.7", () => {
    expect(titleMatchScore("god great", "How Great Is Our God")).toBe(0.7);
  });
  test("partial coverage is capped below the all-present tier", () => {
    // 1 of 2 query tokens present ⇒ 0.5 * 0.6 = 0.3
    expect(titleMatchScore("great elephant", "How Great Is Our God")).toBe(0.3);
  });
  test("no overlap scores 0", () => {
    expect(titleMatchScore("oceans deep", "Amazing Grace")).toBe(0);
  });
  test("empty query or title scores 0", () => {
    expect(titleMatchScore("", "Amazing Grace")).toBe(0);
    expect(titleMatchScore("grace", "")).toBe(0);
  });
});

describe("docTitleScore", () => {
  test("takes the best score across all variant titles (cross-language)", () => {
    const d = doc({ titles: ["How Great Is Our God", "Stor er vår Gud"] });
    expect(docTitleScore("stor er var gud", d)).toBe(1); // matches the Norwegian variant
    expect(docTitleScore("how great is our god", d)).toBe(1);
  });
});

describe("rankScore", () => {
  test("no text match yields 0 regardless of popularity", () => {
    expect(rankScore("oceans", doc({ popularity_score: 10 }))).toBe(0);
  });
  test("popularity nudges but never overturns a clearly better text match", () => {
    const strong = doc({ id: "a", canonical_title: "Amazing Grace", titles: ["Amazing Grace"], popularity_score: 0 });
    const weak = doc({ id: "b", canonical_title: "Amazing Day", titles: ["Amazing Day"], popularity_score: 10 });
    // exact (1.0) vs partial coverage (0.5*0.6=0.3); even max popularity can't flip it.
    expect(rankScore("amazing grace", strong)).toBeGreaterThan(rankScore("amazing grace", weak));
  });
});

describe("rankDocs", () => {
  const a = doc({ id: "a", canonical_title: "Amazing Grace", titles: ["Amazing Grace"], popularity_score: 3 });
  const b = doc({ id: "b", canonical_title: "Amazing Love", titles: ["Amazing Love"], popularity_score: 9 });
  const c = doc({ id: "c", canonical_title: "Oceans", titles: ["Oceans"], popularity_score: 8 });

  test("drops non-matches and sorts best-first", () => {
    const ranked = rankDocs("amazing grace", [a, b, c]);
    expect(ranked.map((r) => r.doc.id)).toEqual(["a", "b"]); // c has no overlap, dropped
    expect(ranked[0]!.doc.id).toBe("a"); // exact beats partial despite b's higher popularity
  });

  test("breaks score ties by popularity then title", () => {
    // Two equal partial matches; higher popularity wins the tie.
    const x = doc({ id: "x", canonical_title: "Great Things", titles: ["Great Things"], popularity_score: 2 });
    const y = doc({ id: "y", canonical_title: "Great Worship", titles: ["Great Worship"], popularity_score: 6 });
    const ranked = rankDocs("great", [x, y]);
    expect(ranked.map((r) => r.doc.id)).toEqual(["y", "x"]);
  });

  test("is deterministic / stable across runs", () => {
    const first = rankDocs("amazing", [a, b, c]).map((r) => r.doc.id);
    const second = rankDocs("amazing", [c, b, a]).map((r) => r.doc.id);
    expect(first).toEqual(second);
  });
});
