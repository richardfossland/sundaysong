import { describe, expect, test } from "bun:test";
import {
  buildRerankPrompt,
  parseRerankResponse,
  applyRerank,
  rerankPicks,
  rankPicks,
  type Candidate,
  type RankedPick,
  type LlmClient,
} from "../src/index";

const base: Omit<Candidate, "id" | "canonical_title" | "semantic_score"> = {
  themes: [],
  bible_refs: [],
  popularity_score: 0,
  language: "en",
};

const grace: Candidate = { ...base, id: "1", canonical_title: "Amazing Grace", themes: ["grace", "salvation"], bible_refs: ["Ephesians 2:8"], semantic_score: 0.5 };
const chains: Candidate = { ...base, id: "2", canonical_title: "Chains Fall", themes: ["freedom"], semantic_score: 0.4 };
const quiet: Candidate = { ...base, id: "3", canonical_title: "Be Still", themes: ["peace"], semantic_score: 0.3 };

const picks: RankedPick[] = [
  { song_id: "1", title: "Amazing Grace", score: 0.9, reason: "heuristic 1" },
  { song_id: "2", title: "Chains Fall", score: 0.8, reason: "heuristic 2" },
  { song_id: "3", title: "Be Still", score: 0.7, reason: "heuristic 3" },
];

/** Fake client returning a canned reply, recording the prompt it saw. */
function fakeClient(reply: string): LlmClient & { lastUser?: string } {
  const c: LlmClient & { lastUser?: string } = {
    model: "fake",
    async complete(messages) {
      c.lastUser = messages[messages.length - 1]?.content;
      return reply;
    },
  };
  return c;
}

describe("buildRerankPrompt", () => {
  test("lists every candidate id and the request signals", () => {
    const p = buildRerankPrompt({ theme: "freedom", arc: "rising" }, picks, [grace, chains, quiet]);
    expect(p).toContain("id=1");
    expect(p).toContain("id=2");
    expect(p).toContain("id=3");
    expect(p).toContain("theme: freedom");
    expect(p).toContain("rising");
    expect(p).toContain("themes: grace, salvation");
  });
});

describe("parseRerankResponse", () => {
  const allowed = ["1", "2", "3"];

  test("parses a clean JSON object", () => {
    const r = parseRerankResponse('{"order":["2","1"],"reasons":{"2":"opens with energy"},"summary":"a freedom set"}', allowed)!;
    expect(r.order).toEqual(["2", "1"]);
    expect(r.reasons["2"]).toBe("opens with energy");
    expect(r.summary).toBe("a freedom set");
  });

  test("tolerates code fences and surrounding prose", () => {
    const raw = 'Here you go:\n```json\n{"order":["1"],"reasons":{}}\n```\nHope that helps!';
    expect(parseRerankResponse(raw, allowed)!.order).toEqual(["1"]);
  });

  test("DROPS hallucinated ids not in the catalog (grounding guarantee)", () => {
    const r = parseRerankResponse('{"order":["1","999","2"],"reasons":{"999":"made up","2":"real"}}', allowed)!;
    expect(r.order).toEqual(["1", "2"]);
    expect(r.reasons["999"]).toBeUndefined();
    expect(r.reasons["2"]).toBe("real");
  });

  test("collapses duplicate ids to first occurrence", () => {
    expect(parseRerankResponse('{"order":["1","1","2"]}', allowed)!.order).toEqual(["1", "2"]);
  });

  test("returns null on non-JSON or empty/unusable payloads", () => {
    expect(parseRerankResponse("the model refused", allowed)).toBeNull();
    expect(parseRerankResponse('{"order":["999"],"reasons":{"999":"x"}}', allowed)).toBeNull();
    expect(parseRerankResponse('{"order":"not an array"}', allowed)).toBeNull();
  });
});

describe("applyRerank", () => {
  const heuristic = rankPicks({}, [grace, chains, quiet]);

  test("reorders to the model order and swaps in model reasons", () => {
    const out = applyRerank(heuristic, { order: ["2", "1", "3"], reasons: { "2": "energetic opener" }, summary: "set summary" });
    expect(out.picks.map((p) => p.song_id)).toEqual(["2", "1", "3"]);
    expect(out.picks[0]!.reason).toBe("energetic opener");
    expect(out.summary).toBe("set summary");
    expect(out.reranked).toBe(true);
  });

  test("appends picks the model omitted, in heuristic order", () => {
    const out = applyRerank(heuristic, { order: ["3"], reasons: {} });
    expect(out.picks[0]!.song_id).toBe("3");
    // 1 and 2 follow in their original relative order
    expect(out.picks.map((p) => p.song_id).slice(1)).toEqual(["1", "2"]);
  });

  test("preserves the heuristic minute estimate", () => {
    const out = applyRerank(heuristic, { order: ["1"], reasons: {} });
    expect(out.total_minutes_estimate).toBe(heuristic.total_minutes_estimate);
  });
});

describe("rerankPicks", () => {
  test("without a client, equals the heuristic rankPicks (free tier)", async () => {
    const out = await rerankPicks({ theme: "grace" }, [grace, chains, quiet], null);
    expect(out.reranked).toBeUndefined();
    expect(out).toEqual(rankPicks({ theme: "grace" }, [grace, chains, quiet]));
  });

  test("with a client, applies the grounded re-rank", async () => {
    const client = fakeClient('{"order":["3","1","2"],"reasons":{"3":"start quiet"},"summary":"gentle build"}');
    const out = await rerankPicks({ arc: "rising" }, [grace, chains, quiet], client);
    expect(out.reranked).toBe(true);
    expect(out.picks[0]!.song_id).toBe("3");
    expect(out.picks[0]!.reason).toBe("start quiet");
    expect(out.summary).toBe("gentle build");
    expect(client.lastUser).toContain("id=1");
  });

  test("falls back to heuristic when the client throws", async () => {
    const boom: LlmClient = { model: "x", async complete() { throw new Error("503 overloaded"); } };
    const out = await rerankPicks({ theme: "grace" }, [grace, chains, quiet], boom);
    expect(out.reranked).toBeUndefined();
    expect(out.picks.length).toBeGreaterThan(0);
  });

  test("falls back to heuristic when the reply is unusable", async () => {
    const out = await rerankPicks({ theme: "grace" }, [grace, chains, quiet], fakeClient("sorry, I can't help"));
    expect(out.reranked).toBeUndefined();
  });

  test("skips the LLM call entirely when there are no picks", async () => {
    let called = false;
    const spy: LlmClient = { model: "x", async complete() { called = true; return "{}"; } };
    const out = await rerankPicks({ language: "de" }, [grace], spy); // language filter ⇒ empty
    expect(out.picks).toHaveLength(0);
    expect(called).toBe(false);
  });
});
