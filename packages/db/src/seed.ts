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
import { upsertChurchLicensing } from "./repositories/church";
import { logUsage } from "./repositories/usage";
import { linkTranslation, type TranslationRelationship } from "./repositories/translations";

/** Demo church for the licensing report — a frikirke with CCLI + direct TONO. */
export const DEMO_CHURCH_ID = "11111111-1111-1111-1111-111111111111";

interface SeedUsage { title: string; date: string; streamed: boolean; key: string }
const USAGE: SeedUsage[] = [
  { title: "How Great Is Our God", date: "2026-04-05", streamed: false, key: "seed-u1" },
  { title: "How Great Is Our God", date: "2026-04-12", streamed: true, key: "seed-u2" },
  { title: "Oceans (Where Feet May Fail)", date: "2026-04-12", streamed: false, key: "seed-u3" },
  { title: "Deg være ære", date: "2026-04-19", streamed: false, key: "seed-u4" },
  { title: "10,000 Reasons (Bless the Lord)", date: "2026-04-26", streamed: true, key: "seed-u5" },
];

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
  // ── Cross-language pairs — the killer feature gets real data ──────────────
  {
    source_name: "ccli", source_external_id: "117947",
    song: { canonical_title: "Lord I Lift Your Name on High", original_language: "en", copyright_status: "copyrighted", ccli_song_id: "117947", tono_work_id: "T-1006", tono_registered: true, themes: ["praise", "salvation"], bible_refs: ["Psalm 18:46"] },
    variant: { title: "Lord I Lift Your Name on High", language: "en", key: "G", attribution_text: "Licensed via CCLI" },
  },
  {
    source_name: "lovsang", source_external_id: "herre-jeg-lofter-ditt-navn",
    song: { canonical_title: "Herre, jeg løfter ditt navn", original_language: "no", copyright_status: "copyrighted", tono_work_id: "T-1007", tono_registered: true, themes: ["lovsang", "frelse"], bible_refs: ["Salme 18:46"] },
    variant: { title: "Herre, jeg løfter ditt navn", language: "no", key: "G", attribution_text: "Content from lovsang.no" },
  },
  {
    source_name: "hymnary", source_external_id: "be-thou-my-vision",
    song: { canonical_title: "Be Thou My Vision", original_language: "en", copyright_status: "public_domain", year_first_published: 1905, hymnary_id: "be_thou_my_vision", themes: ["guidance", "devotion"], bible_refs: ["Proverbs 3:5"] },
    variant: { title: "Be Thou My Vision", language: "en", key: "Eb", attribution_text: "Content from Hymnary.org" },
  },
];

/** Explicit translation links (Phase 3.3 mechanism 1). */
interface SeedTranslation { from: string; to: string; relationship: TranslationRelationship; attribution?: string }
const TRANSLATIONS: SeedTranslation[] = [
  { from: "How Great Is Our God", to: "Stor er du Gud", relationship: "official", attribution: "Norsk tekst" },
  { from: "Lord I Lift Your Name on High", to: "Herre, jeg løfter ditt navn", relationship: "official", attribution: "Norsk gjendiktning" },
];

async function main(): Promise<void> {
  const sql = createSql();
  try {
    for (const s of SOURCES) await upsertSource(sql, s);
    let added = 0;
    let updated = 0;
    const songIdByTitle = new Map<string, string>();
    for (const song of SONGS) {
      const r = await upsertSongWithVariant(sql, song);
      songIdByTitle.set(song.song.canonical_title, r.song_id);
      if (r.action === "added") added += 1; else updated += 1;
    }
    console.log(`✓ seeded ${SOURCES.length} sources, ${SONGS.length} songs (${added} added, ${updated} updated)`);

    let linked = 0;
    for (const t of TRANSLATIONS) {
      const from = songIdByTitle.get(t.from);
      const to = songIdByTitle.get(t.to);
      if (!from || !to) continue;
      await linkTranslation(sql, {
        source_song_id: from, target_song_id: to,
        relationship: t.relationship, attribution: t.attribution ?? null, verified_by: "admin",
      });
      linked += 1;
    }
    console.log(`✓ linked ${linked} translation pairs`);

    await upsertChurchLicensing(sql, {
      church_id: DEMO_CHURCH_ID,
      ccli_license_number: "CCLI-DEMO-001",
      ccli_size_category: "B",
      ccli_streaming_addon: true,
      tono_license_status: "direct_agreement",
      tono_customer_id: "TONO-DEMO",
      tono_streaming_addon: true,
      denomination: "frikirke",
    });

    let logged = 0;
    for (const u of USAGE) {
      const songId = songIdByTitle.get(u.title);
      if (!songId) continue;
      const r = await logUsage(sql, {
        church_id: DEMO_CHURCH_ID,
        song_id: songId,
        service_date: u.date,
        was_streamed: u.streamed,
        idempotency_key: u.key,
      });
      if (r.logged) logged += 1;
    }
    console.log(`✓ seeded demo church ${DEMO_CHURCH_ID} + ${USAGE.length} usage rows (${logged} new)`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("✗ seed failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
