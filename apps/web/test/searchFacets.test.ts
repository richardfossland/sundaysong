/**
 * Tests for the /songs facet sidebar logic — pure grouping + filtering over a
 * page of already-fetched hits. Runs OFFLINE under `bun test` with no DOM, API
 * or network.
 */

import { describe, expect, test } from "bun:test";

import type { SearchHit, Song, SongVariant } from "@sundaysong/shared";
import { applyFacets, buildFacets, facetParam } from "@/lib/searchFacets";

function song(overrides: Partial<Song>): Song {
  return {
    id: "s",
    canonical_title: "Title",
    original_language: "no",
    year_first_published: null,
    copyright_status: "public_domain",
    ccli_song_id: null,
    tono_work_id: null,
    tono_registered: false,
    hymnary_id: null,
    popularity_score: 0,
    nordic_metadata: {},
    themes: [],
    bible_refs: [],
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function variant(language: string): SongVariant {
  return { language } as SongVariant;
}

function hit(overrides: Partial<Song>, variants: SongVariant[] = []): SearchHit {
  return {
    song: song(overrides),
    variants,
    translations: [],
    match_reason: "text",
    score: 1,
  };
}

describe("buildFacets", () => {
  test("returns no groups for no hits", () => {
    expect(buildFacets([])).toEqual([]);
  });

  test("groups by language across original + variants, de-duped, upper-cased", () => {
    const hits = [
      hit({ id: "a", original_language: "no" }, [variant("en")]),
      hit({ id: "b", original_language: "no" }, [variant("no")]),
    ];
    const groups = buildFacets(hits);
    const lang = groups.find((g) => g.kind === "language")!;
    expect(lang.title).toBe("Language");
    expect(lang.buckets).toEqual([
      { value: "no", label: "NO", count: 2 },
      { value: "en", label: "EN", count: 1 },
    ]);
  });

  test("counts a song once per theme bucket and sorts by count then label", () => {
    const hits = [
      hit({ id: "a", themes: ["grace", "hope"] }),
      hit({ id: "b", themes: ["grace"] }),
      hit({ id: "c", themes: ["faith"] }),
    ];
    const theme = buildFacets(hits).find((g) => g.kind === "theme")!;
    expect(theme.buckets).toEqual([
      { value: "grace", label: "grace", count: 2 },
      { value: "faith", label: "faith", count: 1 },
      { value: "hope", label: "hope", count: 1 },
    ]);
  });

  test("humanises copyright status labels", () => {
    const hits = [
      hit({ id: "a", copyright_status: "public_domain" }),
      hit({ id: "b", copyright_status: "copyrighted" }),
      hit({ id: "c", copyright_status: "public_domain" }),
    ];
    const cr = buildFacets(hits).find((g) => g.kind === "copyright")!;
    expect(cr.buckets).toEqual([
      { value: "public_domain", label: "Public domain", count: 2 },
      { value: "copyrighted", label: "Copyrighted", count: 1 },
    ]);
  });

  test("omits an empty dimension (no themes anywhere)", () => {
    const groups = buildFacets([hit({ id: "a", themes: [] })]);
    expect(groups.some((g) => g.kind === "theme")).toBe(false);
    expect(groups.some((g) => g.kind === "language")).toBe(true);
  });
});

describe("applyFacets", () => {
  const hits = [
    hit({ id: "a", original_language: "no", themes: ["grace"], copyright_status: "public_domain" }),
    hit({ id: "b", original_language: "en", themes: ["grace"], copyright_status: "copyrighted" }, [variant("no")]),
    hit({ id: "c", original_language: "en", themes: ["hope"], copyright_status: "public_domain" }),
  ];

  test("empty selection returns all hits unchanged", () => {
    expect(applyFacets(hits, {})).toBe(hits);
  });

  test("filters by a single theme", () => {
    expect(applyFacets(hits, { theme: "grace" }).map((h) => h.song.id)).toEqual(["a", "b"]);
  });

  test("filters by language across variants", () => {
    expect(applyFacets(hits, { language: "no" }).map((h) => h.song.id)).toEqual(["a", "b"]);
  });

  test("ANDs across dimensions", () => {
    expect(
      applyFacets(hits, { theme: "grace", copyright: "public_domain" }).map((h) => h.song.id),
    ).toEqual(["a"]);
  });

  test("a selection matching nothing yields no hits", () => {
    expect(applyFacets(hits, { theme: "grace", language: "de" })).toEqual([]);
  });
});

describe("facetParam", () => {
  test("maps each dimension to its URL key", () => {
    expect(facetParam("theme")).toBe("theme");
    expect(facetParam("language")).toBe("lang");
    expect(facetParam("copyright")).toBe("copyright");
  });
});
