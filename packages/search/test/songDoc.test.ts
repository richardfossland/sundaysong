import { describe, expect, test } from "bun:test";
import type { Song, SongVariant } from "@sundaysong/shared";
import { songToSearchDoc, SONG_INDEX_SETTINGS } from "../src/songDoc";

function song(overrides: Partial<Song> = {}): Song {
  return {
    id: "s1", canonical_title: "How Great Is Our God", original_language: "en",
    year_first_published: 2004, copyright_status: "copyrighted",
    ccli_song_id: "4348399", tono_work_id: "T-1002", tono_registered: true,
    hymnary_id: null, popularity_score: 7, nordic_metadata: {},
    themes: ["greatness", "worship"], bible_refs: ["Psalm 104:1"],
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}
function variant(title: string, language: string): SongVariant {
  return {
    id: title, song_id: "s1", source_id: "src", source_external_id: null,
    title, language, key: null, bpm: null, meter: null, structure: [],
    lyrics_excerpt: null, lyrics_url: null, chord_chart_url: null, audio_demo_url: null,
    attribution_required: true, attribution_text: null, license_info: null,
    imported_at: "2026-01-01T00:00:00Z", last_verified_at: null,
  };
}

describe("songToSearchDoc", () => {
  test("flattens canonical + variant titles and languages, deduped", () => {
    const doc = songToSearchDoc(song(), [
      variant("How Great Is Our God", "en"),
      variant("Stor er vår Gud", "no"),
    ]);
    expect(doc.id).toBe("s1");
    expect(doc.titles).toEqual(["How Great Is Our God", "Stor er vår Gud"]); // canonical not duplicated
    expect(doc.languages).toEqual(["en", "no"]);
    expect(doc.themes).toEqual(["greatness", "worship"]);
    expect(doc.tono_work_id).toBe("T-1002");
    expect(doc.ccli_song_id).toBe("4348399");
    expect(doc.popularity_score).toBe(7);
  });

  test("handles a song with no variants", () => {
    const doc = songToSearchDoc(song({ canonical_title: "Amazing Grace", original_language: "en" }), []);
    expect(doc.titles).toEqual(["Amazing Grace"]);
    expect(doc.languages).toEqual(["en"]);
  });

  test("settings expose the expected facets", () => {
    expect(SONG_INDEX_SETTINGS.searchableAttributes).toContain("titles");
    expect(SONG_INDEX_SETTINGS.filterableAttributes).toContain("languages");
    expect(SONG_INDEX_SETTINGS.sortableAttributes).toContain("popularity_score");
  });
});
