import { describe, expect, test } from "bun:test";
import {
  syllableCount,
  lyricLines,
  assessSingability,
  canTranslate,
  isTranslatableQuality,
  buildTranslationPrompt,
  parseTranslationResponse,
  draftTranslation,
  TranslationRefused,
  type DraftTranslationRequest,
  type LlmClient,
} from "../src/index";

describe("syllableCount", () => {
  test("counts vowel groups", () => {
    expect(syllableCount("amazing")).toBe(3); // a-ma-zing
    expect(syllableCount("grace")).toBe(1); // silent terminal e
  });

  test("handles Nordic vowels", () => {
    expect(syllableCount("nåde", "no")).toBe(2); // nå-de
    expect(syllableCount("ærefrykt", "no")).toBeGreaterThanOrEqual(2);
  });

  test("multi-word lines sum per word", () => {
    expect(syllableCount("Amazing grace how sweet")).toBe(3 + 1 + 1 + 1);
  });

  test("line-ending punctuation does not change the silent-e estimate", () => {
    // The English silent terminal-e discount must survive trailing punctuation:
    // "grace," / "grace." should still count as 1 syllable, like "grace".
    expect(syllableCount("grace,")).toBe(1);
    expect(syllableCount("grace.")).toBe(1);
    expect(syllableCount("Amazing grace,")).toBe(syllableCount("Amazing grace"));
  });
});

describe("lyricLines", () => {
  test("drops blank/stanza-break lines and trims", () => {
    expect(lyricLines("  a \n\n b \n")).toEqual(["a", "b"]);
  });
});

describe("canTranslate (copyright gate)", () => {
  test("allows public domain", () => {
    expect(canTranslate({ copyright_status: "public_domain", user_uploaded: false }).allowed).toBe(true);
  });

  test("allows the user's own upload regardless of status", () => {
    expect(canTranslate({ copyright_status: "copyrighted", user_uploaded: true }).allowed).toBe(true);
  });

  test("refuses copyrighted content that isn't the user's", () => {
    const r = canTranslate({ copyright_status: "copyrighted", user_uploaded: false });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("copyrighted");
  });

  test("refuses unknown status", () => {
    expect(canTranslate({ copyright_status: "unknown", user_uploaded: false }).allowed).toBe(false);
  });
});

describe("isTranslatableQuality", () => {
  test("rejects fewer than two lines", () => {
    expect(isTranslatableQuality("just one line here").ok).toBe(false);
  });

  test("rejects near-empty / garbage", () => {
    expect(isTranslatableQuality("a\nb").ok).toBe(false); // too few letters
  });

  test("accepts a real couplet", () => {
    expect(isTranslatableQuality("Amazing grace how sweet the sound\nThat saved a wretch like me").ok).toBe(true);
  });
});

describe("assessSingability", () => {
  const source = "Amazing grace how sweet the sound\nThat saved a wretch like me";

  test("high confidence when lines + syllables track", () => {
    // A draft of matching shape (same line count, close syllables).
    const draft = "Underfulle nåde klang så søt\nsom frelste arme meg";
    const r = assessSingability(source, draft, "en", "no");
    expect(r.lines).toHaveLength(2);
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  test("warns + lowers confidence on line-count mismatch", () => {
    const r = assessSingability(source, "bare én linje", "en", "no");
    expect(r.warnings.some((w) => w.toLowerCase().includes("line count"))).toBe(true);
    expect(r.confidence).toBeLessThan(0.6);
  });

  test("warns on big per-line syllable drift", () => {
    const draft = "en\nto"; // far too few syllables vs the source lines
    const r = assessSingability(source, draft, "en", "no");
    expect(r.warnings.some((w) => w.includes("3+"))).toBe(true);
  });
});

describe("buildTranslationPrompt", () => {
  test("embeds per-line syllable targets and the line count constraint", () => {
    const req: DraftTranslationRequest = {
      source_title: "Amazing Grace",
      source_lyrics: "Amazing grace how sweet the sound\nThat saved a wretch like me",
      source_language: "en",
      target_language: "no",
      style: "traditional Norwegian hymnal",
      context: { copyright_status: "public_domain", user_uploaded: false },
    };
    const p = buildTranslationPrompt(req);
    expect(p).toContain("from en to no");
    expect(p).toContain("traditional Norwegian hymnal");
    expect(p).toContain("(8) Amazing grace how sweet the sound");
    expect(p).toContain("exactly 2 lyric lines");
  });
});

describe("parseTranslationResponse", () => {
  test("parses fenced JSON with escaped newlines", () => {
    const raw = '```json\n{"title":"Underfull nåde","lyrics":"linje en\\nlinje to"}\n```';
    const r = parseTranslationResponse(raw)!;
    expect(r.title).toBe("Underfull nåde");
    expect(r.lyrics).toBe("linje en\nlinje to");
  });

  test("returns null without lyrics", () => {
    expect(parseTranslationResponse('{"title":"x"}')).toBeNull();
    expect(parseTranslationResponse("no json here")).toBeNull();
  });
});

describe("draftTranslation", () => {
  const baseReq: DraftTranslationRequest = {
    source_title: "Amazing Grace",
    source_lyrics: "Amazing grace how sweet the sound\nThat saved a wretch like me",
    source_language: "en",
    target_language: "no",
    context: { copyright_status: "public_domain", user_uploaded: false },
  };
  const client: LlmClient = {
    model: "fake",
    async complete() {
      return '{"title":"Underfull nåde","lyrics":"Underfulle nåde klang så søt\\nsom frelste arme meg"}';
    },
  };

  test("produces a draft with singability + disclaimer", async () => {
    const d = await draftTranslation(baseReq, client);
    expect(d.title).toBe("Underfull nåde");
    expect(d.singability.lines).toHaveLength(2);
    expect(d.model).toBe("fake");
    expect(d.disclaimer.toLowerCase()).toContain("draft");
  });

  test("refuses copyrighted non-upload BEFORE calling the model", async () => {
    let called = false;
    const spy: LlmClient = { model: "x", async complete() { called = true; return "{}"; } };
    const req = { ...baseReq, context: { copyright_status: "copyrighted" as const, user_uploaded: false } };
    await expect(draftTranslation(req, spy)).rejects.toBeInstanceOf(TranslationRefused);
    expect(called).toBe(false);
  });

  test("refuses when no client is configured (Pro gate)", async () => {
    await expect(draftTranslation(baseReq, null)).rejects.toBeInstanceOf(TranslationRefused);
  });

  test("refuses an unusable model reply", async () => {
    const bad: LlmClient = { model: "x", async complete() { return "sorry"; } };
    await expect(draftTranslation(baseReq, bad)).rejects.toBeInstanceOf(TranslationRefused);
  });
});
