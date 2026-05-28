/**
 * Repository integration tests — run against a throwaway `sundaysong_test`
 * database created and dropped per run, so they never touch dev/seed data.
 *
 * REQUIRES a running Postgres (`pnpm db:up`). Without it, beforeAll fails fast.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createSql, type Sql } from "../src/sql";
import { DEFAULT_DATABASE_URL, MIGRATIONS_DIR } from "../src/config";
import { sortMigrations } from "../src/planner";
import { upsertSource, getSourceByName } from "../src/repositories/sources";
import { insertSong, getSong, searchSongsByTitle } from "../src/repositories/songs";
import { upsertSongWithVariant } from "../src/repositories/ingest";
import { logUsage, usageForPeriod } from "../src/repositories/usage";
import { upsertPerson, lyricistsForSong } from "../src/repositories/persons";

const base = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
const withDb = (db: string) => { const u = new URL(base); u.pathname = "/" + db; return u.toString(); };
const adminUrl = withDb("sundaysong");
const testUrl = withDb("sundaysong_test");

let admin: Sql;
let sql: Sql;

beforeAll(async () => {
  admin = createSql(adminUrl);
  await admin`drop database if exists sundaysong_test with (force)`;
  await admin`create database sundaysong_test`;
  sql = createSql(testUrl);
  for (const file of sortMigrations(readdirSync(MIGRATIONS_DIR))) {
    await sql.unsafe(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
});

afterAll(async () => {
  await sql?.end();
  await admin`drop database if exists sundaysong_test with (force)`;
  await admin.end();
});

beforeEach(async () => {
  await sql`truncate source, song, song_variant, usage_log, translation, person restart identity cascade`;
});

const CHURCH = "00000000-0000-0000-0000-0000000000aa";

describe("sources", () => {
  test("upsert is idempotent on name", async () => {
    const a = await upsertSource(sql, { name: "hymnary", kind: "api" });
    const b = await upsertSource(sql, { name: "hymnary", kind: "api" });
    expect(a.id).toBe(b.id);
    expect((await getSourceByName(sql, "hymnary"))?.id).toBe(a.id);
  });
});

describe("songs", () => {
  test("insert + get round-trips arrays and jsonb", async () => {
    const inserted = await insertSong(sql, {
      canonical_title: "Stor er du Gud",
      original_language: "no",
      copyright_status: "copyrighted",
      themes: ["storhet", "lovsang"],
      bible_refs: ["Salme 104:1"],
      nordic_metadata: { in_salmebok_2013: true, salme_number: 308 },
    });
    const got = await getSong(sql, inserted.id);
    expect(got?.themes).toEqual(["storhet", "lovsang"]);
    expect(got?.bible_refs).toEqual(["Salme 104:1"]);
    expect(got?.nordic_metadata.salme_number).toBe(308);
    expect(got?.copyright_status).toBe("copyrighted");
  });

  test("fuzzy title search finds partial matches", async () => {
    await insertSong(sql, { canonical_title: "Amazing Grace", original_language: "en" });
    await insertSong(sql, { canonical_title: "How Great Is Our God", original_language: "en" });
    const hits = await searchSongsByTitle(sql, "grace");
    expect(hits.map((h) => h.canonical_title)).toContain("Amazing Grace");
  });
});

describe("upsertSongWithVariant (connector idempotency anchor)", () => {
  const payload = {
    source_name: "hymnary",
    source_external_id: "amazing-grace",
    song: { canonical_title: "Amazing Grace", original_language: "en", copyright_status: "public_domain" as const },
    variant: { title: "Amazing Grace", language: "en", key: "G" },
  };

  test("first import adds, second updates the same rows (no duplicate)", async () => {
    const a = await upsertSongWithVariant(sql, payload);
    expect(a.action).toBe("added");
    const b = await upsertSongWithVariant(sql, { ...payload, song: { ...payload.song, canonical_title: "Amazing Grace (rev)" } });
    expect(b.action).toBe("updated");
    expect(b.song_id).toBe(a.song_id);

    const songCount = (await sql<Array<{ n: number }>>`select count(*)::int n from song`)[0]!.n;
    const variantCount = (await sql<Array<{ n: number }>>`select count(*)::int n from song_variant`)[0]!.n;
    expect(songCount).toBe(1);
    expect(variantCount).toBe(1);
    expect((await getSong(sql, a.song_id))?.canonical_title).toBe("Amazing Grace (rev)");
  });
});

describe("persons + lyricist linking", () => {
  test("upsertPerson dedupes on display name", async () => {
    const a = await upsertPerson(sql, "Hans Adolph Brorson");
    const b = await upsertPerson(sql, "Hans Adolph Brorson");
    expect(a.id).toBe(b.id);
  });

  test("upsertSongWithVariant links lyricists, idempotently", async () => {
    const payload = {
      source_name: "salmebok",
      source_external_id: "brorson-test",
      song: { canonical_title: "Den store hvite flokk", original_language: "no", copyright_status: "public_domain" as const },
      variant: { title: "Den store hvite flokk", language: "no" },
      lyricists: ["Hans Adolph Brorson"],
    };
    const first = await upsertSongWithVariant(sql, payload);
    await upsertSongWithVariant(sql, payload); // re-import

    const lyricists = await lyricistsForSong(sql, first.song_id);
    expect(lyricists.map((l) => l.display_name)).toEqual(["Hans Adolph Brorson"]); // no duplicate link
  });

  test("two songs by the same author share one person row", async () => {
    const a = await upsertSongWithVariant(sql, {
      source_name: "salmebok", source_external_id: "blix-a",
      song: { canonical_title: "No livnar det i lundar", original_language: "nn", copyright_status: "public_domain" },
      variant: { title: "No livnar det i lundar", language: "nn" }, lyricists: ["Elias Blix"],
    });
    const b = await upsertSongWithVariant(sql, {
      source_name: "salmebok", source_external_id: "blix-b",
      song: { canonical_title: "Gud signe vårt dyre fedreland", original_language: "nn", copyright_status: "public_domain" },
      variant: { title: "Gud signe vårt dyre fedreland", language: "nn" }, lyricists: ["Elias Blix"],
    });
    const [la] = await lyricistsForSong(sql, a.song_id);
    const [lb] = await lyricistsForSong(sql, b.song_id);
    expect(la!.id).toBe(lb!.id);
  });
});

describe("usage_log", () => {
  test("logUsage dedupes on idempotency_key", async () => {
    const song = await insertSong(sql, { canonical_title: "X", original_language: "en" });
    const first = await logUsage(sql, { church_id: CHURCH, song_id: song.id, service_date: "2026-05-03", idempotency_key: "k1" });
    const dup = await logUsage(sql, { church_id: CHURCH, song_id: song.id, service_date: "2026-05-03", idempotency_key: "k1" });
    expect(first.logged).toBe(true);
    expect(dup.logged).toBe(false);
    const rows = await usageForPeriod(sql, CHURCH, "2026-05-01", "2026-05-31");
    expect(rows).toHaveLength(1);
  });

  test("usageForPeriod filters by church and date range", async () => {
    const song = await insertSong(sql, { canonical_title: "Y", original_language: "en" });
    await logUsage(sql, { church_id: CHURCH, song_id: song.id, service_date: "2026-05-10", idempotency_key: "a" });
    await logUsage(sql, { church_id: CHURCH, song_id: song.id, service_date: "2026-07-10", idempotency_key: "b" }); // out of range
    await logUsage(sql, { church_id: "00000000-0000-0000-0000-0000000000bb", song_id: song.id, service_date: "2026-05-11", idempotency_key: "c" }); // other church
    const rows = await usageForPeriod(sql, CHURCH, "2026-05-01", "2026-06-30");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.idempotency_key).toBe("a");
  });
});
