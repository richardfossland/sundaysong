import { describe, expect, test } from "bun:test";
import { scoreTranslationCandidate, proposeCandidates } from "../src/candidates";
import type { MatchSong } from "../src/types";

const lordEn: MatchSong = {
  id: "en1",
  canonical_title: "Lord I Lift Your Name on High",
  language: "en",
  themes: ["praise", "exaltation"],
  bible_refs: ["Psalm 18:46", "2 Samuel 22:47"],
  year_first_published: 1989,
  composer_ids: ["rick-founds"],
};

const herreNo: MatchSong = {
  id: "no1",
  canonical_title: "Herre, jeg løfter ditt navn",
  language: "nb",
  themes: ["praise", "exaltation", "worship"],
  bible_refs: ["Psalm 18:46"],
  year_first_published: 1995,
  composer_ids: ["rick-founds"],
};

const signalNames = (c: ReturnType<typeof scoreTranslationCandidate>) => c.signals.map((s) => s.name);

describe("scoreTranslationCandidate", () => {
  test("the canonical cross-language pair is proposed for review", () => {
    const c = scoreTranslationCandidate(lordEn, herreNo);
    expect(c.recommendation).toBe("propose");
    expect(c.confidence).toBeGreaterThan(0.5);
    expect(c.confidence).toBeLessThan(AUTO());
    expect(signalNames(c)).toEqual(expect.arrayContaining(["bible_refs", "themes", "shared_composer", "year_proximity"]));
  });

  test("a shared CCLI registration pushes it to auto-link", () => {
    const c = scoreTranslationCandidate(
      { ...lordEn, ccli_song_id: "117947" },
      { ...herreNo, ccli_song_id: "117947" },
    );
    expect(c.recommendation).toBe("auto_link");
    expect(c.confidence).toBeGreaterThanOrEqual(0.8);
    expect(signalNames(c)).toContain("shared_ccli");
  });

  test("same language is never a translation candidate", () => {
    const c = scoreTranslationCandidate(lordEn, { ...herreNo, language: "en" });
    expect(c.recommendation).toBe("reject");
    expect(c.confidence).toBe(0);
    expect(signalNames(c)).toEqual(["same_language"]);
  });

  test("nb and nn collapse to the same language (not a translation)", () => {
    const c = scoreTranslationCandidate({ ...lordEn, language: "nn" }, { ...herreNo, language: "nb" });
    expect(c.recommendation).toBe("reject");
  });

  test("unrelated songs in different languages are rejected", () => {
    const other: MatchSong = {
      id: "x", canonical_title: "Cornerstone", language: "en",
      themes: ["faith"], bible_refs: ["Matthew 7:24"], year_first_published: 2011, composer_ids: ["a"],
    };
    expect(scoreTranslationCandidate(herreNo, other).recommendation).toBe("reject");
  });

  test("fuzzy title cognates register a (weak) signal", () => {
    const a: MatchSong = { id: "a", canonical_title: "Hallelujah", language: "en" };
    const b: MatchSong = { id: "b", canonical_title: "Halleluja", language: "no" };
    const c = scoreTranslationCandidate(a, b);
    expect(signalNames(c)).toContain("title_tokens");
    expect(c.confidence).toBeGreaterThan(0); // but below propose on title alone
    expect(c.recommendation).toBe("reject");
  });

  test("title tokens are Nordic-folded: keyboard/accent variants share tokens", () => {
    // "Frälsare" (sv, ä) vs "Fralsare" (typed without the key) must fold to the
    // same token, just like search does — this is the consolidation's whole point.
    const a: MatchSong = { id: "a", canonical_title: "Frälsare", language: "sv" };
    const b: MatchSong = { id: "b", canonical_title: "Fralsare", language: "en" };
    const c = scoreTranslationCandidate(a, b);
    expect(signalNames(c)).toContain("title_tokens");

    // ø/æ/å fold too: "Når mitt øye" ≡ "Naar mitt oeie"-style spelling.
    const na: MatchSong = { id: "na", canonical_title: "Når mitt øye", language: "nb" };
    const nb: MatchSong = { id: "nb", canonical_title: "Naar mitt oye", language: "en" };
    expect(signalNames(scoreTranslationCandidate(na, nb))).toContain("title_tokens");
  });
});

describe("proposeCandidates", () => {
  test("ranks links above threshold, best first, excludes rejects", () => {
    const pool: MatchSong[] = [
      herreNo, // propose
      { ...herreNo, id: "no2", ccli_song_id: "117947" }, // auto (shared ccli with target below)
      { id: "x", canonical_title: "Different Song", language: "sv", themes: ["x"], bible_refs: ["y"], year_first_published: 1700 }, // reject
    ];
    const target = { ...lordEn, ccli_song_id: "117947" };
    const ranked = proposeCandidates(target, pool);
    expect(ranked).toHaveLength(2);
    expect(ranked[0]!.b_id).toBe("no2"); // auto-link scores highest
    expect(ranked[0]!.confidence).toBeGreaterThanOrEqual(ranked[1]!.confidence);
    expect(ranked.map((r) => r.b_id)).not.toContain("x");
  });

  test("excludes the target itself", () => {
    expect(proposeCandidates(lordEn, [lordEn, herreNo]).map((r) => r.b_id)).toEqual(["no1"]);
  });
});

// Auto-link threshold, kept in one place so the assertion reads clearly.
function AUTO(): number {
  return 0.8;
}
