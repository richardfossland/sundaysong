import { describe, expect, test } from "bun:test";
import { resolveTranslations } from "../src/translations";
import type { TranslationEdge, TranslationSongMeta } from "../src/types";

const meta: Record<string, TranslationSongMeta> = {
  en1: { language: "en", canonical_title: "Lord I Lift Your Name on High" },
  no1: { language: "no", canonical_title: "Herre, jeg løfter ditt navn" },
  sv1: { language: "sv", canonical_title: "Herre, jag lyfter ditt namn" },
  da1: { language: "da", canonical_title: "Herre, jeg løfter dit navn" },
};

describe("resolveTranslations", () => {
  test("direct links are returned with their relationship", () => {
    const edges: TranslationEdge[] = [
      { source_song_id: "en1", target_song_id: "no1", relationship: "official", verified_by: "admin" },
    ];
    const links = resolveTranslations("en1", edges, meta);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ song_id: "no1", language: "no", relationship: "official", direct: true });
  });

  test("works from either direction of the edge", () => {
    const edges: TranslationEdge[] = [
      { source_song_id: "en1", target_song_id: "no1", relationship: "official" },
    ];
    expect(resolveTranslations("no1", edges, meta)[0]).toMatchObject({ song_id: "en1", direct: true });
  });

  test("transitive members are included but ranked below direct ones", () => {
    // en1 - no1 (official), no1 - sv1 (official). sv1 is transitive from en1.
    const edges: TranslationEdge[] = [
      { source_song_id: "en1", target_song_id: "no1", relationship: "official" },
      { source_song_id: "no1", target_song_id: "sv1", relationship: "official" },
    ];
    const links = resolveTranslations("en1", edges, meta);
    const byId = Object.fromEntries(links.map((l) => [l.song_id, l]));
    expect(byId.no1).toMatchObject({ relationship: "official", direct: true });
    expect(byId.sv1).toMatchObject({ relationship: "transitive", direct: false });
    // direct official sorts before transitive
    expect(links[0]!.song_id).toBe("no1");
  });

  test("sorts by relationship quality, then verifier, then language", () => {
    const edges: TranslationEdge[] = [
      { source_song_id: "en1", target_song_id: "da1", relationship: "paraphrase" },
      { source_song_id: "en1", target_song_id: "no1", relationship: "official", verified_by: "admin" },
      { source_song_id: "en1", target_song_id: "sv1", relationship: "unofficial", verified_by: "community" },
    ];
    const order = resolveTranslations("en1", edges, meta).map((l) => l.song_id);
    expect(order).toEqual(["no1", "sv1", "da1"]);
  });

  test("cycles do not loop forever and exclude the query song", () => {
    const edges: TranslationEdge[] = [
      { source_song_id: "en1", target_song_id: "no1", relationship: "official" },
      { source_song_id: "no1", target_song_id: "en1", relationship: "official" },
    ];
    const links = resolveTranslations("en1", edges, meta);
    expect(links.map((l) => l.song_id)).toEqual(["no1"]);
  });

  test("picks the strongest edge when a pair has several", () => {
    const edges: TranslationEdge[] = [
      { source_song_id: "en1", target_song_id: "no1", relationship: "paraphrase", verified_by: "ai_with_review" },
      { source_song_id: "en1", target_song_id: "no1", relationship: "official", verified_by: "admin" },
    ];
    expect(resolveTranslations("en1", edges, meta)[0]).toMatchObject({ relationship: "official", verified_by: "admin" });
  });

  test("songs missing metadata are skipped", () => {
    const edges: TranslationEdge[] = [
      { source_song_id: "en1", target_song_id: "ghost", relationship: "official" },
    ];
    expect(resolveTranslations("en1", edges, meta)).toHaveLength(0);
  });
});
