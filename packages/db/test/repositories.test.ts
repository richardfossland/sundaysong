/**
 * Repository integration tests — run against a throwaway `sundaysong_test`
 * database created and dropped per run, so they never touch dev/seed data.
 *
 * REQUIRES a running Postgres (`pnpm db:up`). Offline (no Postgres reachable)
 * the whole suite is skipped with a clear message instead of throwing raw
 * connection stacks, so `pnpm -r test` stays green for local dev without
 * Docker. CI provides the service, so the tests run there. Set
 * SUNDAYSONG_REQUIRE_SERVICES=1 to fail (not skip) when Postgres is unreachable.
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
import { linkTranslation, translationsForSong, translationsForSongs } from "../src/repositories/translations";
import {
  createUpload,
  listUploadsByStatus,
  getUpload,
  updateUploadStatus,
  addModerationNote,
  moderationHistory,
  uploadCountsByStatus,
} from "../src/repositories/uploads";
import { applyAction } from "@sundaysong/shared";

const base = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
const withDb = (db: string) => { const u = new URL(base); u.pathname = "/" + db; return u.toString(); };
const adminUrl = withDb("sundaysong");
const testUrl = withDb("sundaysong_test");

let admin: Sql;
let sql: Sql;

// Probe Postgres once: a reachable server is required for these live tests.
const reachable = await (async () => {
  const probe = createSql(adminUrl);
  try {
    await probe`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => {});
  }
})();

if (!reachable) {
  if (process.env.SUNDAYSONG_REQUIRE_SERVICES === "1") {
    throw new Error(`Postgres not reachable at ${adminUrl} but SUNDAYSONG_REQUIRE_SERVICES=1`);
  }
  console.warn(`[db] Postgres not reachable at ${adminUrl} — skipping live repository tests (run \`pnpm db:up\`).`);
}

beforeAll(async () => {
  if (!reachable) return;
  admin = createSql(adminUrl);
  await admin`drop database if exists sundaysong_test with (force)`;
  await admin`create database sundaysong_test`;
  sql = createSql(testUrl);
  for (const file of sortMigrations(readdirSync(MIGRATIONS_DIR))) {
    await sql.unsafe(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
});

afterAll(async () => {
  if (!reachable) return;
  await sql?.end();
  await admin`drop database if exists sundaysong_test with (force)`;
  await admin.end();
});

beforeEach(async () => {
  if (!reachable) return;
  await sql`truncate source, song, song_variant, usage_log, translation, person, upload restart identity cascade`;
});

const CHURCH = "00000000-0000-0000-0000-0000000000aa";

describe.skipIf(!reachable)("sources", () => {
  test("upsert is idempotent on name", async () => {
    const a = await upsertSource(sql, { name: "hymnary", kind: "api" });
    const b = await upsertSource(sql, { name: "hymnary", kind: "api" });
    expect(a.id).toBe(b.id);
    expect((await getSourceByName(sql, "hymnary"))?.id).toBe(a.id);
  });
});

describe.skipIf(!reachable)("songs", () => {
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

describe.skipIf(!reachable)("upsertSongWithVariant (connector idempotency anchor)", () => {
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

describe.skipIf(!reachable)("persons + lyricist linking", () => {
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

describe.skipIf(!reachable)("translations (cross-language linking)", () => {
  async function pair() {
    const en = await insertSong(sql, { canonical_title: "How Great Is Our God", original_language: "en" });
    const no = await insertSong(sql, { canonical_title: "Stor er du Gud", original_language: "no" });
    await linkTranslation(sql, { source_song_id: en.id, target_song_id: no.id, relationship: "official", attribution: "Norsk tekst" });
    return { en, no };
  }

  test("surfaces the link from both directions", async () => {
    const { en, no } = await pair();
    const fromEn = await translationsForSong(sql, en.id);
    expect(fromEn).toHaveLength(1);
    expect(fromEn[0]!.title).toBe("Stor er du Gud");
    expect(fromEn[0]!.direction).toBe("to");

    const fromNo = await translationsForSong(sql, no.id);
    expect(fromNo).toHaveLength(1);
    expect(fromNo[0]!.title).toBe("How Great Is Our God");
    expect(fromNo[0]!.direction).toBe("from");
  });

  test("linkTranslation is idempotent on the pair", async () => {
    const { en, no } = await pair();
    await linkTranslation(sql, { source_song_id: en.id, target_song_id: no.id, relationship: "unofficial" });
    const links = await translationsForSong(sql, en.id);
    expect(links).toHaveLength(1);
    expect(links[0]!.relationship).toBe("unofficial"); // upsert updated in place
  });

  test("bulk translationsForSongs groups by owner", async () => {
    const { en, no } = await pair();
    const map = await translationsForSongs(sql, [en.id, no.id]);
    expect(map.get(en.id)).toHaveLength(1);
    expect(map.get(no.id)).toHaveLength(1);
  });
});

describe.skipIf(!reachable)("usage_log", () => {
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

describe.skipIf(!reachable)("uploads (moderation envelope — Phase 8)", () => {
  async function seedSong(title = "Velsignet er den dag") {
    return await insertSong(sql, { canonical_title: title, original_language: "no", copyright_status: "public_domain" });
  }

  test("createUpload starts pending and round-trips the record shape", async () => {
    const song = await seedSong();
    const up = await createUpload(sql, {
      song_id: song.id,
      title: "Velsignet er den dag",
      language: "no",
      copyright_status: "public_domain",
      submitted_by: "Maria",
    });
    expect(up.status).toBe("pending");
    expect(up.submitted_by).toBe("Maria");
    expect(up.copyright_status).toBe("public_domain");
    expect(typeof up.submitted_at).toBe("string"); // ISO string, not a Date

    const got = await getUpload(sql, up.id);
    expect(got?.id).toBe(up.id);
    expect(got?.song_id).toBe(song.id);
    expect(got?.moderator_note).toBeNull();
  });

  test("listUploadsByStatus filters by status and orders newest first", async () => {
    const a = await seedSong("Song A");
    const b = await seedSong("Song B");
    const c = await seedSong("Song C");
    const upA = await createUpload(sql, { song_id: a.id, title: "Song A", language: "en" });
    await createUpload(sql, { song_id: b.id, title: "Song B", language: "en" });
    const upC = await createUpload(sql, { song_id: c.id, title: "Song C", language: "en" });

    // Approve one so it leaves the pending queue.
    const decision = applyAction("pending", "approve");
    expect(decision.ok).toBe(true);
    await updateUploadStatus(sql, upA.id, decision.status, "approve");

    const all = await listUploadsByStatus(sql);
    expect(all).toHaveLength(3);

    const pending = await listUploadsByStatus(sql, "pending");
    expect(pending).toHaveLength(2);
    expect(pending.every((u) => u.status === "pending")).toBe(true);
    expect(pending.find((u) => u.id === upA.id)).toBeUndefined(); // approved one is gone
    expect(pending.find((u) => u.id === upC.id)).toBeDefined();

    const approved = await listUploadsByStatus(sql, "approved");
    expect(approved).toHaveLength(1);
    expect(approved[0]!.id).toBe(upA.id);
  });

  test("updateUploadStatus appends to the note history and surfaces the latest note", async () => {
    const song = await seedSong();
    const up = await createUpload(sql, { song_id: song.id, title: "T", language: "no" });

    await updateUploadStatus(sql, up.id, "changes_requested", "request_changes", "Add the chord chart.");
    await updateUploadStatus(sql, up.id, "resubmitted", "resubmit");
    await updateUploadStatus(sql, up.id, "approved", "approve", "Looks good now.");

    const final = await getUpload(sql, up.id);
    expect(final?.status).toBe("approved");
    expect(final?.moderator_note).toBe("Looks good now."); // latest scalar note

    const history = await moderationHistory(sql, up.id);
    expect(history).toHaveLength(3);
    expect(history.map((h) => h.action)).toEqual(["request_changes", "resubmit", "approve"]);
    expect(history[0]!.note).toBe("Add the chord chart.");
    expect(history[1]!.note).toBeNull();
    expect(history[0]!.status).toBe("changes_requested");
  });

  test("addModerationNote appends without changing status", async () => {
    const song = await seedSong();
    const up = await createUpload(sql, { song_id: song.id, title: "T", language: "no" });
    await addModerationNote(sql, up.id, "Flagging for a second reviewer.");

    const got = await getUpload(sql, up.id);
    expect(got?.status).toBe("pending"); // unchanged
    expect(got?.moderator_note).toBe("Flagging for a second reviewer.");
    expect(await moderationHistory(sql, up.id)).toHaveLength(1);
  });

  test("uploadCountsByStatus aggregates the queue (analytics view)", async () => {
    for (const t of ["A", "B", "C"]) {
      const s = await seedSong("Song " + t);
      await createUpload(sql, { song_id: s.id, title: "Song " + t, language: "en" });
    }
    const oneApproved = await seedSong("Song D");
    const up = await createUpload(sql, { song_id: oneApproved.id, title: "Song D", language: "en" });
    await updateUploadStatus(sql, up.id, "approved", "approve");

    const counts = await uploadCountsByStatus(sql);
    expect(counts.pending).toBe(3);
    expect(counts.approved).toBe(1);
  });

  test("upsertSongWithVariant opens a moderation envelope only for user uploads", async () => {
    // A connector import (no `upload` field) creates no envelope.
    const connectorRes = await upsertSongWithVariant(sql, {
      source_name: "hymnary",
      source_external_id: "no-envelope",
      song: { canonical_title: "Imported Hymn", original_language: "en", copyright_status: "public_domain" },
      variant: { title: "Imported Hymn", language: "en" },
    });
    expect(connectorRes.upload_id).toBeUndefined();
    expect(await listUploadsByStatus(sql)).toHaveLength(0);

    // A user contribution (with `upload`) creates a pending envelope in the same tx.
    const userRes = await upsertSongWithVariant(sql, {
      source_name: "user_upload",
      source_kind: "user_upload",
      source_external_id: crypto.randomUUID(),
      song: { canonical_title: "My New Song", original_language: "no", copyright_status: "public_domain" },
      variant: { title: "My New Song", language: "no" },
      upload: { submitted_by: "Jonas" },
    });
    expect(userRes.upload_id).toBeDefined();

    const queue = await listUploadsByStatus(sql, "pending");
    expect(queue).toHaveLength(1);
    expect(queue[0]!.id).toBe(userRes.upload_id!);
    expect(queue[0]!.song_id).toBe(userRes.song_id);
    expect(queue[0]!.title).toBe("My New Song");
    expect(queue[0]!.submitted_by).toBe("Jonas");
  });
});
