import type { Song, CopyrightStatus, NordicMetadata } from "@sundaysong/shared";
import type { Executor } from "./types";
import { toPgTextArray } from "./encode";

export interface SongInput {
  canonical_title: string;
  original_language: string;
  copyright_status?: CopyrightStatus;
  year_first_published?: number | null;
  ccli_song_id?: string | null;
  tono_work_id?: string | null;
  tono_registered?: boolean;
  hymnary_id?: string | null;
  themes?: string[];
  bible_refs?: string[];
  nordic_metadata?: NordicMetadata;
}

export async function insertSong(sql: Executor, input: SongInput): Promise<Song> {
  const rows = await sql<Song[]>`
    insert into song (
      canonical_title, original_language, copyright_status, year_first_published,
      ccli_song_id, tono_work_id, tono_registered, hymnary_id, themes, bible_refs, nordic_metadata
    ) values (
      ${input.canonical_title}, ${input.original_language}, ${input.copyright_status ?? "unknown"},
      ${input.year_first_published ?? null}, ${input.ccli_song_id ?? null}, ${input.tono_work_id ?? null},
      ${input.tono_registered ?? false}, ${input.hymnary_id ?? null},
      ${toPgTextArray(input.themes ?? [])}::text[], ${toPgTextArray(input.bible_refs ?? [])}::text[],
      ${input.nordic_metadata ?? {}}::jsonb
    )
    returning *
  `;
  return rows[0]!;
}

export async function updateSong(sql: Executor, id: string, input: SongInput): Promise<void> {
  await sql`
    update song set
      canonical_title = ${input.canonical_title},
      original_language = ${input.original_language},
      copyright_status = ${input.copyright_status ?? "unknown"},
      year_first_published = ${input.year_first_published ?? null},
      ccli_song_id = ${input.ccli_song_id ?? null},
      tono_work_id = ${input.tono_work_id ?? null},
      tono_registered = ${input.tono_registered ?? false},
      hymnary_id = ${input.hymnary_id ?? null},
      themes = ${toPgTextArray(input.themes ?? [])}::text[],
      bible_refs = ${toPgTextArray(input.bible_refs ?? [])}::text[],
      nordic_metadata = ${input.nordic_metadata ?? {}}::jsonb
    where id = ${id}
  `;
}

export async function getSong(sql: Executor, id: string): Promise<Song | null> {
  const rows = await sql<Song[]>`select * from song where id = ${id}`;
  return rows[0] ?? null;
}

/** Fuzzy title search using the pg_trgm similarity index (Phase 3.1 fallback). */
export async function searchSongsByTitle(sql: Executor, q: string, limit = 20, offset = 0): Promise<Song[]> {
  return await sql<Song[]>`
    select * from song
    where canonical_title ilike ${"%" + q + "%"}
    order by similarity(canonical_title, ${q}) desc, popularity_score desc
    limit ${limit} offset ${offset}
  `;
}

export async function listSongs(sql: Executor, limit = 50): Promise<Song[]> {
  return await sql<Song[]>`select * from song order by created_at desc limit ${limit}`;
}

export async function getSongsByIds(sql: Executor, ids: string[]): Promise<Song[]> {
  if (ids.length === 0) return [];
  return await sql<Song[]>`select * from song where id in ${sql(ids)}`;
}
