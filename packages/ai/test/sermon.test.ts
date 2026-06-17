/**
 * Unit tests for Sermon-to-Setlist extraction (@sundaysong/ai sermon.ts).
 *
 * All offline: the pure prompt builder, response parser, scripture sweep,
 * keyword/arc heuristic, and the `extractSermon` orchestrator are exercised
 * with canned `LlmClient` replies — no network, no key. The keyless-fallback
 * path (the free tier + the LLM-failure path) is the headline guarantee here.
 */

import { describe, expect, test } from "bun:test";
import {
  extractScriptureRefs,
  keywordCandidates,
  guessArc,
  heuristicExtract,
  buildSermonPrompt,
  parseSermonResponse,
  extractSermon,
  sermonToRecommendRequest,
  type LlmClient,
  type SermonExtractRequest,
} from "../src/index";

/** Fake client returning a canned reply, recording the prompt it saw. */
function fakeClient(reply: string): LlmClient & { lastUser?: string; lastSystem?: string } {
  const c: LlmClient & { lastUser?: string; lastSystem?: string } = {
    model: "fake",
    async complete(messages, opts) {
      c.lastUser = messages[messages.length - 1]?.content;
      c.lastSystem = opts?.system;
      return reply;
    },
  };
  return c;
}

/** A client that always throws — to prove the LLM-failure fallback. */
const throwingClient: LlmClient = {
  model: "boom",
  async complete() {
    throw new Error("api down");
  },
};

const SERMON =
  "Tittel: Den bortkomne sønn. I Lukas 15:11-32 møter vi en far full av nåde og tilgivelse. " +
  "Sønnen vender hjem, og faren løper ham i møte. Dette handler om nåde, omvendelse og fest. " +
  "Salme 103 minner oss om Guds barmhjertighet. Nåde, nåde, nåde — det er evangeliets hjerte.";

describe("extractScriptureRefs", () => {
  test("finds English + Norwegian refs with chapter:verse ranges", () => {
    const refs = extractScriptureRefs("See Luke 15:11-32 and Salme 103 and Romans 8.");
    expect(refs.some((r) => /Luke 15:11-32/i.test(r))).toBe(true);
    expect(refs.some((r) => /Salme 103/i.test(r))).toBe(true);
    expect(refs.some((r) => /Romans 8/i.test(r))).toBe(true);
  });

  test("dedupes and returns [] for ref-less text", () => {
    expect(extractScriptureRefs("no scripture here at all")).toEqual([]);
    const dup = extractScriptureRefs("Salme 23 ... Salme 23 again");
    expect(dup.filter((r) => /Salme 23/i.test(r)).length).toBe(1);
  });
});

describe("keywordCandidates", () => {
  test("ranks by frequency, drops stopwords + short tokens", () => {
    const kw = keywordCandidates(SERMON);
    expect(kw[0]).toBe("nåde"); // appears most often
    expect(kw).not.toContain("og");
    expect(kw).not.toContain("i");
    expect(kw.every((w) => w.length >= 4)).toBe(true);
  });

  test("empty text → []", () => {
    expect(keywordCandidates("")).toEqual([]);
  });
});

describe("guessArc", () => {
  test("celebration for resurrection / praise language", () => {
    expect(guessArc("Han er oppstanden! Vi feirer seier og lovpriser.")).toBe("celebration");
  });
  test("lament for grief / cross language", () => {
    expect(guessArc("Et budskap om sorg, lidelse og korset.")).toBe("lament");
  });
  test("null when ambiguous", () => {
    expect(guessArc("ordinary words with no mood signal whatsoever")).toBeNull();
  });
});

describe("heuristicExtract (keyless fallback)", () => {
  test("produces a usable extract with source=heuristic", () => {
    const e = heuristicExtract({ manuscript: SERMON });
    expect(e.source).toBe("heuristic");
    expect(e.themes.length).toBeGreaterThan(0);
    expect(e.themes).toContain("nåde");
    expect(e.scripture.some((r) => /Lukas 15:11-32/i.test(r))).toBe(true);
    expect(e.keywords.length).toBeGreaterThan(0);
  });

  test("merges explicit scripture_refs with swept refs", () => {
    const e = heuristicExtract({ manuscript: "Bare tema her", scripture_refs: ["Jesaja 53"] });
    expect(e.scripture).toContain("Jesaja 53");
  });
});

describe("buildSermonPrompt", () => {
  test("includes the manuscript, explicit refs and the JSON shape", () => {
    const p = buildSermonPrompt({ manuscript: SERMON, scripture_refs: ["Lukas 15"], title: "X" });
    expect(p).toContain("Lukas 15");
    expect(p).toContain("Den bortkomne");
    expect(p).toContain('"themes"');
    expect(p).toContain('"arc"');
    expect(p).toContain("Tittel: X");
  });
});

describe("parseSermonResponse", () => {
  test("parses a clean object and clamps arc", () => {
    const e = parseSermonResponse(
      '{"themes":["nåde","tilgivelse"],"scripture":["Lukas 15:11-32"],"arc":"celebration","keywords":["nåde","far"],"summary":"Om nåde."}',
    )!;
    expect(e.source).toBe("llm");
    expect(e.themes).toEqual(["nåde", "tilgivelse"]);
    expect(e.arc).toBe("celebration");
    expect(e.summary).toBe("Om nåde.");
  });

  test("tolerates prose/fences and invalid arc → null arc", () => {
    const e = parseSermonResponse('Here you go:\n```json\n{"themes":["x"],"scripture":[],"keywords":[],"arc":"weird"}\n```')!;
    expect(e.themes).toEqual(["x"]);
    expect(e.arc).toBeNull();
  });

  test("drops non-string list entries + dedupes", () => {
    const e = parseSermonResponse('{"themes":["a","a",2,null,"b"],"scripture":[],"keywords":[]}')!;
    expect(e.themes).toEqual(["a", "b"]);
  });

  test("returns null when nothing usable (all empty / garbage)", () => {
    expect(parseSermonResponse("not json")).toBeNull();
    expect(parseSermonResponse('{"themes":[],"scripture":[],"keywords":[]}')).toBeNull();
  });
});

describe("extractSermon orchestrator", () => {
  const req: SermonExtractRequest = { manuscript: SERMON, scripture_refs: ["Salme 23"] };

  test("no client → heuristic extract, still usable", async () => {
    const e = await extractSermon(req, null);
    expect(e.source).toBe("heuristic");
    expect(e.themes.length).toBeGreaterThan(0);
  });

  test("LLM failure → falls back to heuristic (never throws)", async () => {
    const e = await extractSermon(req, throwingClient);
    expect(e.source).toBe("heuristic");
  });

  test("unusable LLM reply → heuristic", async () => {
    const e = await extractSermon(req, fakeClient("garbage, no json"));
    expect(e.source).toBe("heuristic");
  });

  test("good LLM reply → llm extract, sends the Norwegian system prompt", async () => {
    const client = fakeClient('{"themes":["nåde"],"scripture":["Lukas 15:11-32"],"arc":"celebration","keywords":["far"],"summary":"s"}');
    const e = await extractSermon(req, client);
    expect(e.source).toBe("llm");
    expect(e.arc).toBe("celebration");
    expect(client.lastSystem).toContain("gudstjenesteplanlegging");
    // Explicit + swept refs are folded in even if the model omitted them.
    expect(e.scripture).toContain("Salme 23");
    expect(e.scripture.some((r) => /Lukas 15:11-32/i.test(r))).toBe(true);
  });
});

describe("sermonToRecommendRequest", () => {
  test("maps lead theme/scripture + folds keywords into description", () => {
    const req = sermonToRecommendRequest(
      { themes: ["nåde", "fest"], scripture: ["Lukas 15"], arc: "celebration", keywords: ["far", "sønn"], summary: "", source: "llm" },
      { language: "no", duration_min: 20 },
    );
    expect(req.theme).toBe("nåde");
    expect(req.scripture).toBe("Lukas 15");
    expect(req.arc).toBe("celebration");
    expect(req.language).toBe("no");
    expect(req.duration_min).toBe(20);
    expect(req.description).toContain("nåde");
    expect(req.description).toContain("far");
  });

  test("null arc → undefined arc (no-op downstream)", () => {
    const req = sermonToRecommendRequest({ themes: ["x"], scripture: [], arc: null, keywords: [], summary: "", source: "heuristic" });
    expect(req.arc).toBeUndefined();
  });
});
