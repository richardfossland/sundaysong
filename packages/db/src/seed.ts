/**
 * Seed data.
 *
 *   DATABASE_URL=... bun run src/seed.ts
 *
 * Idempotent (re-running updates in place via the source_external_id anchor).
 * Gives search, licensing, and matching realistic material: a mix of
 * languages, PD vs copyrighted, and Norwegian works with tono_work_id so the
 * CCLI/TONO logic has something true to chew on.
 */

import { createSql } from "./sql";
import { upsertSource, type SourceKind } from "./repositories/sources";
import { upsertSongWithVariant, type UpsertSongWithVariantInput } from "./repositories/ingest";

const SOURCES: Array<{ name: string; kind: SourceKind; attribution_template: string }> = [
  { name: "hymnary", kind: "api", attribution_template: "Content from Hymnary.org" },
  { name: "ccli", kind: "api", attribution_template: "Licensed via CCLI" },
  { name: "tono", kind: "manual", attribution_template: "Registered with TONO" },
  { name: "lovsang", kind: "api", attribution_template: "Content from lovsang.no" },
  { name: "salmebok", kind: "manual", attribution_template: "Norsk salmebok" },
  { name: "user_upload", kind: "user_upload", attribution_template: "User contribution" },
];

const SONGS: UpsertSongWithVariantInput[] = [
  {
    source_name: "hymnary", source_external_id: "amazing-grace",
    song: { canonical_title: "Amazing Grace", original_language: "en", copyright_status: "public_domain", year_first_published: 1779, hymnary_id: "amazing_grace", themes: ["grace", "salvation"], bible_refs: ["Ephesians 2:8"] },
    variant: { title: "Amazing Grace", language: "en", key: "G", attribution_text: "Content from Hymnary.org" },
  },
  {
    source_name: "salmebok", source_external_id: "salme-285",
    song: { canonical_title: "Deg være ære", original_language: "no", copyright_status: "public_domain", tono_work_id: "T-1001", tono_registered: true, themes: ["påske", "oppstandelse"], bible_refs: ["Matteus 28:6"], nordic_metadata: { in_salmebok_2013: true, salme_number: 285 } },
    variant: { title: "Deg være ære", language: "no", key: "D", attribution_text: "Norsk salmebok" },
  },
  {
    source_name: "ccli", source_external_id: "4348399",
    song: { canonical_title: "How Great Is Our God", original_language: "en", copyright_status: "copyrighted", ccli_song_id: "4348399", tono_work_id: "T-1002", tono_registered: true, themes: ["greatness", "worship"], bible_refs: ["Psalm 104:1"] },
    variant: { title: "How Great Is Our God", language: "en", key: "C", attribution_text: "Licensed via CCLI" },
  },
  {
    source_name: "lovsang", source_external_id: "stor-er-du-gud",
    song: { canonical_title: "Stor er du Gud", original_language: "no", copyright_status: "copyrighted", tono_work_id: "T-1003", tono_registered: true, themes: ["storhet", "lovsang"], bible_refs: ["Salme 104:1"] },
    variant: { title: "Stor er du Gud", language: "no", key: "C", attribution_text: "Content from lovsang.no" },
  },
  {
    source_name: "ccli", source_external_id: "6428767",
    song: { canonical_title: "Oceans (Where Feet May Fail)", original_language: "en", copyright_status: "copyrighted", ccli_song_id: "6428767", themes: ["faith", "trust"], bible_refs: ["Matthew 14:29"] },
    variant: { title: "Oceans (Where Feet May Fail)", language: "en", key: "D", attribution_text: "Licensed via CCLI" },
  },
  {
    source_name: "salmebok", source_external_id: "salme-310",
    song: { canonical_title: "Navnet Jesus", original_language: "no", copyright_status: "public_domain", tono_work_id: "T-1004", tono_registered: true, themes: ["jesus", "tilbedelse"], bible_refs: ["Filipperne 2:9"], nordic_metadata: { in_salmebok_2013: true, salme_number: 310 } },
    variant: { title: "Navnet Jesus", language: "no", key: "F", attribution_text: "Norsk salmebok" },
  },
  {
    source_name: "hymnary", source_external_id: "tryggare-kan-ingen",
    song: { canonical_title: "Tryggare kan ingen vara", original_language: "sv", copyright_status: "public_domain", themes: ["trygghet", "barn"], bible_refs: ["Psalm 91:1"] },
    variant: { title: "Tryggare kan ingen vara", language: "sv", key: "F", attribution_text: "Content from Hymnary.org" },
  },
  {
    source_name: "ccli", source_external_id: "6016351",
    song: { canonical_title: "10,000 Reasons (Bless the Lord)", original_language: "en", copyright_status: "copyrighted", ccli_song_id: "6016351", tono_work_id: "T-1005", tono_registered: true, themes: ["praise", "thankfulness"], bible_refs: ["Psalm 103:1"] },
    variant: { title: "10,000 Reasons (Bless the Lord)", language: "en", key: "G", attribution_text: "Licensed via CCLI" },
  },
];

async function main(): Promise<void> {
  const sql = createSql();
  try {
    for (const s of SOURCES) await upsertSource(sql, s);
    let added = 0;
    let updated = 0;
    for (const song of SONGS) {
      const r = await upsertSongWithVariant(sql, song);
      if (r.action === "added") added += 1; else updated += 1;
    }
    console.log(`✓ seeded ${SOURCES.length} sources, ${SONGS.length} songs (${added} added, ${updated} updated)`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("✗ seed failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
