import { describe, expect, test } from "bun:test";
import {
  HymnaryConnector,
  normalizeHymnary,
  decideCopyright,
  parseHymnaryYear,
  PD_PUBLICATION_CUTOFF,
  PD_LIFE_PLUS_YEARS,
  type RawHymnaryText,
} from "../src/sources/hymnary";

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

describe("HymnaryConnector", () => {
  test("normalize() delegates to the pure mapper with the connector's nowYear", () => {
    const c = new HymnaryConnector({ nowYear: NOW });
    expect(c.source).toBe("hymnary");
    expect(c.normalize(amazingGrace).copyright_status).toBe("public_domain");
  });

  // NETWORK-UNVERIFIED paths (discover/fetch) are exercised with an injected
  // fetch so the wiring is covered without any real outbound network.
  test("discover() pages via injected fetch", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ texts: [{ text_id: "a" }, { text_id: "b" }], has_more: true }), {
        status: 200,
      })) as unknown as typeof fetch;
    const c = new HymnaryConnector({ fetchImpl });
    const page = await c.discover();
    expect(page.externalIds).toEqual(["a", "b"]);
    expect(page.nextCursor).toBe("2");
  });

  test("fetch() returns the raw record via injected fetch", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify(amazingGrace), { status: 200 })) as unknown as typeof fetch;
    const c = new HymnaryConnector({ fetchImpl });
    const raw = await c.fetch("amazing_grace_how_sweet_the_sound");
    expect(raw.title).toBe("Amazing Grace! how sweet the sound");
  });

  test("fetch() throws a status-tagged error on HTTP failure", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    const c = new HymnaryConnector({ fetchImpl });
    await expect(c.fetch("missing")).rejects.toThrow("hymnary fetch 404");
  });
});
