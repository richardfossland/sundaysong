import { describe, expect, test } from "bun:test";
import {
  HymnaryConnector,
  normalizeHymnary,
  decideCopyright,
  parseHymnaryYear,
  parseTextIdFromLink,
  parseScriptureItem,
  parseScriptureResponse,
  DEFAULT_DISCOVERY_REFERENCES,
  PD_PUBLICATION_CUTOFF,
  PD_LIFE_PLUS_YEARS,
  type RawHymnaryText,
} from "../src/sources/hymnary";

/**
 * A single item shaped like Hymnary's real /api/scripture JSON: human-readable,
 * space-separated keys ("text link", "number of hymnals", "scripture
 * references", "originalLanguage") and people under role keys.
 */
const liveScriptureItem: Record<string, unknown> = {
  title: "Amazing Grace! how sweet the sound",
  date: "1779",
  meter: "8.6.8.6",
  "place of origin": "England",
  originalLanguage: "English",
  "text link": "https://hymnary.org/text/amazing_grace_how_sweet_the_sound",
  "number of hymnals": 1287,
  "scripture references": ["1 Chronicles 17:16-17", "Ephesians 2:8"],
  author: "John Newton",
};

const NOW = 2026;

const amazingGrace: RawHymnaryText = {
  text_id: "amazing_grace_how_sweet_the_sound",
  title: "Amazing Grace! how sweet the sound",
  language: "English",
  authors: [{ name: "John Newton", role: "author", born: 1725, died: 1807 }],
  date: 1779,
  scripture_references: ["1 Chronicles 17:16-17"],
  topics: ["Grace", "Assurance"],
};

const modernCopyrighted: RawHymnaryText = {
  text_id: "in_christ_alone",
  title: "In Christ Alone",
  language: "English",
  authors: [
    { name: "Keith Getty", role: "author", born: 1974, died: null },
    { name: "Stuart Townend", role: "author", born: 1963, died: null },
  ],
  date: 2001,
  copyright: "© 2001 Thankyou Music",
};

describe("parseHymnaryYear", () => {
  test("passes through a numeric year", () => {
    expect(parseHymnaryYear(1779)).toBe(1779);
  });
  test("extracts a year from a 'c. 1779' string", () => {
    expect(parseHymnaryYear("c. 1779")).toBe(1779);
  });
  test("returns undefined for null / unparseable", () => {
    expect(parseHymnaryYear(null)).toBeUndefined();
    expect(parseHymnaryYear("sometime")).toBeUndefined();
  });
});

describe("decideCopyright", () => {
  test("an explicit Public Domain string wins", () => {
    const d = decideCopyright({ ...amazingGrace, copyright: "Public Domain" }, NOW);
    expect(d.status).toBe("public_domain");
    expect(d.reason).toContain("Public Domain");
  });

  test("life + 70: long-dead author ⇒ public domain", () => {
    const d = decideCopyright(amazingGrace, NOW);
    expect(d.status).toBe("public_domain");
    expect(d.reason).toContain(String(PD_LIFE_PLUS_YEARS));
  });

  test("a single living text author blocks life+70 ⇒ copyrighted via death math", () => {
    const recent: RawHymnaryText = {
      text_id: "x",
      title: "X",
      authors: [{ name: "Living Writer", role: "author", died: 2010 }],
      date: 2008,
    };
    expect(decideCopyright(recent, NOW).status).toBe("copyrighted");
  });

  test("pre-1929 publication ⇒ public domain when death years are missing", () => {
    const old: RawHymnaryText = {
      text_id: "y",
      title: "Old Hymn",
      authors: [{ name: "Unknown", role: "author" }],
      date: 1850,
    };
    const d = decideCopyright(old, NOW);
    expect(d.status).toBe("public_domain");
    expect(d.reason).toContain(String(PD_PUBLICATION_CUTOFF));
  });

  test("explicit modern copyright string ⇒ copyrighted", () => {
    expect(decideCopyright(modernCopyrighted, NOW).status).toBe("copyrighted");
  });

  test("no usable evidence ⇒ unknown, never guessed into PD", () => {
    const bare: RawHymnaryText = { text_id: "z", title: "Mystery Song", date: 1990 };
    const d = decideCopyright(bare, NOW);
    expect(d.status).toBe("unknown");
    expect(d.reason).toContain("review");
  });

  test("a living composer does not block PD when the text author is long dead", () => {
    const hymn: RawHymnaryText = {
      text_id: "w",
      title: "Old Text, New Tune",
      authors: [
        { name: "Long Dead Poet", role: "author", died: 1800 },
        { name: "Living Composer", role: "composer", died: null },
      ],
      date: 1799,
    };
    expect(decideCopyright(hymn, NOW).status).toBe("public_domain");
  });
});

describe("normalizeHymnary", () => {
  test("maps a public-domain hymn to a canonical NormalizedSong", () => {
    const doc = normalizeHymnary(amazingGrace, NOW);
    expect(doc).toMatchObject({
      source: "hymnary",
      source_external_id: "amazing_grace_how_sweet_the_sound",
      canonical_title: "Amazing Grace! how sweet the sound",
      original_language: "en",
      copyright_status: "public_domain",
      year_first_published: 1779,
      hymnary_id: "amazing_grace_how_sweet_the_sound",
    });
    expect(doc.lyricists).toEqual(["John Newton"]);
    expect(doc.themes).toEqual(["Grace", "Assurance"]);
  });

  test("links out to Hymnary and never carries lyrics", () => {
    const doc = normalizeHymnary(amazingGrace, NOW);
    expect(doc.variant.lyrics_url).toBe("https://hymnary.org/text/amazing_grace_how_sweet_the_sound");
    expect(doc.variant).not.toHaveProperty("lyrics_excerpt");
    expect(doc.variant.attribution_text).toContain("John Newton");
    expect(doc.variant.attribution_text).toContain("Hymnary.org");
  });

  test("folds Norwegian language names to short codes", () => {
    const doc = normalizeHymnary({ ...amazingGrace, language: "Norwegian" }, NOW);
    expect(doc.original_language).toBe("no");
  });

  test("falls back to first_line when title is missing", () => {
    const doc = normalizeHymnary(
      { text_id: "fl", title: "", first_line: "Holy, holy, holy", date: 1826 },
      NOW,
    );
    expect(doc.canonical_title).toBe("Holy, holy, holy");
  });

  test("throws a permanent error on a record with no title at all", () => {
    expect(() => normalizeHymnary({ text_id: "empty", title: "" }, NOW)).toThrow("no title");
  });

  test("copyrighted modern song normalizes with copyrighted status + no PD claim", () => {
    const doc = normalizeHymnary(modernCopyrighted, NOW);
    expect(doc.copyright_status).toBe("copyrighted");
    expect(doc.lyricists).toEqual(["Keith Getty", "Stuart Townend"]);
  });
});

describe("parseTextIdFromLink", () => {
  test("pulls the slug out of a text-authority URL", () => {
    expect(parseTextIdFromLink("https://hymnary.org/text/amazing_grace_how_sweet_the_sound")).toBe(
      "amazing_grace_how_sweet_the_sound",
    );
  });
  test("ignores query/hash after the slug", () => {
    expect(parseTextIdFromLink("https://hymnary.org/text/foo?bar=1#x")).toBe("foo");
  });
  test("returns undefined for a non-text link or empty", () => {
    expect(parseTextIdFromLink("https://hymnary.org/tune/foo")).toBeUndefined();
    expect(parseTextIdFromLink(null)).toBeUndefined();
  });
});

describe("parseScriptureItem (real Hymnary JSON shape)", () => {
  test("maps human-readable keys onto our internal RawHymnaryText", () => {
    const raw = parseScriptureItem(liveScriptureItem)!;
    expect(raw.text_id).toBe("amazing_grace_how_sweet_the_sound");
    expect(raw.title).toBe("Amazing Grace! how sweet the sound");
    expect(raw.language).toBe("English");
    expect(raw.date).toBe("1779");
    expect(raw.scripture_references).toEqual(["1 Chronicles 17:16-17", "Ephesians 2:8"]);
    expect(raw.authors).toEqual([{ name: "John Newton", role: "author" }]);
  });

  test("a parsed item normalizes to a public-domain song end-to-end", () => {
    const raw = parseScriptureItem(liveScriptureItem)!;
    const doc = normalizeHymnary(raw, NOW);
    expect(doc.copyright_status).toBe("public_domain");
    expect(doc.canonical_title).toBe("Amazing Grace! how sweet the sound");
    expect(doc.year_first_published).toBe(1779);
    expect(doc.lyricists).toEqual(["John Newton"]);
  });

  test("collects multiple people across role keys, incl. born/died objects", () => {
    const raw = parseScriptureItem({
      title: "Old Text, New Tune",
      "text link": "https://hymnary.org/text/w",
      author: { name: "Long Dead Poet", died: 1800 },
      composer: ["Living Composer"],
      date: 1799,
    })!;
    expect(raw.authors).toContainEqual({ name: "Long Dead Poet", role: "author", born: null, died: 1800 });
    expect(raw.authors).toContainEqual({ name: "Living Composer", role: "composer" });
    // The living composer must not block PD when the text author is long dead.
    expect(decideCopyright(raw, NOW).status).toBe("public_domain");
  });

  test("splits a comma/semicolon scripture-reference string into an array", () => {
    const raw = parseScriptureItem({
      title: "T",
      "text link": "https://hymnary.org/text/t",
      "scripture references": "Psalm 23; John 10:11",
    })!;
    expect(raw.scripture_references).toEqual(["Psalm 23", "John 10:11"]);
  });

  test("skips an item with no text-authority link (no bogus id minted)", () => {
    expect(parseScriptureItem({ title: "Linkless", "number of hymnals": 2 })).toBeUndefined();
  });
});

describe("parseScriptureResponse", () => {
  test("accepts a JSON array of items", () => {
    const recs = parseScriptureResponse([liveScriptureItem]);
    expect(recs).toHaveLength(1);
    expect(recs[0]!.text_id).toBe("amazing_grace_how_sweet_the_sound");
  });

  test("accepts an object keyed by index string (Hymnary's wrapper form)", () => {
    const recs = parseScriptureResponse({ "0": liveScriptureItem, "1": liveScriptureItem });
    expect(recs).toHaveLength(2);
  });

  test("drops linkless items and tolerates a non-collection body", () => {
    const recs = parseScriptureResponse([liveScriptureItem, { title: "no link" }]);
    expect(recs).toHaveLength(1);
    expect(parseScriptureResponse(null)).toEqual([]);
  });
});

describe("HymnaryConnector", () => {
  test("normalize() delegates to the pure mapper with the connector's nowYear", () => {
    const c = new HymnaryConnector({ nowYear: NOW });
    expect(c.source).toBe("hymnary");
    expect(c.normalize(amazingGrace).copyright_status).toBe("public_domain");
  });

  test("ships a non-empty default discovery reference list", () => {
    expect(DEFAULT_DISCOVERY_REFERENCES.length).toBeGreaterThan(0);
  });

  // NETWORK-UNVERIFIED paths (discover/fetch) are exercised with an injected
  // fetch so the wiring is covered without any real outbound network.
  test("discover() queries /api/scripture by reference and pages through the list", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify([liveScriptureItem]), { status: 200 });
    }) as unknown as typeof fetch;
    const c = new HymnaryConnector({ fetchImpl, references: ["Psalm 23", "John 3:16"] });

    const first = await c.discover();
    expect(calls[0]).toContain("/api/scripture?reference=Psalm%2023");
    expect(first.externalIds).toEqual(["amazing_grace_how_sweet_the_sound"]);
    expect(first.nextCursor).toBe("1");

    const second = await c.discover(first.nextCursor);
    expect(calls[1]).toContain("reference=John%203%3A16");
    expect(second.nextCursor).toBeUndefined(); // last reference ⇒ done
  });

  test("discover() past the last reference yields an empty terminal page", async () => {
    const fetchImpl = (async () => new Response("[]", { status: 200 })) as unknown as typeof fetch;
    const c = new HymnaryConnector({ fetchImpl, references: ["Psalm 23"] });
    const page = await c.discover("5");
    expect(page.externalIds).toEqual([]);
    expect(page.nextCursor).toBeUndefined();
  });

  test("fetch() serves a record harvested during discover() (no extra HTTP)", async () => {
    let httpCalls = 0;
    const fetchImpl = (async () => {
      httpCalls++;
      return new Response(JSON.stringify([liveScriptureItem]), { status: 200 });
    }) as unknown as typeof fetch;
    const c = new HymnaryConnector({ fetchImpl, references: ["Psalm 23"] });
    await c.discover();
    const raw = await c.fetch("amazing_grace_how_sweet_the_sound");
    expect(raw.title).toBe("Amazing Grace! how sweet the sound");
    expect(httpCalls).toBe(1); // only discover hit the network
  });

  test("fetch() of an unseen id is a status-404 (permanent) error", async () => {
    const fetchImpl = (async () => new Response("[]", { status: 200 })) as unknown as typeof fetch;
    const c = new HymnaryConnector({ fetchImpl, references: [] });
    await expect(c.fetch("never_discovered")).rejects.toThrow("not in discover cache");
  });

  test("discover() throws a status-tagged error on HTTP failure", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    const c = new HymnaryConnector({ fetchImpl, references: ["Psalm 23"] });
    await expect(c.discover()).rejects.toThrow("hymnary discover 503");
  });
});
