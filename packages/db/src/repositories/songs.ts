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

/**
 * Optional musical filters for the trigram fallback search. These constrain on
 * the song's variants (bpm/key live on `song_variant`, not `song`): a song
 * matches when it has *some* variant satisfying the given bounds. Applied INSIDE
 * the windowed query (before limit/offset) so paging and the candidate count
 * stay consistent — never post-hoc over the returned page.
 */
export interface SongVariantFilter {
  bpm_min?: number;
  bpm_max?: number;
  /** Exact musical key (case-insensitive), e.g. "G", "Bb". */
  key?: string;
}

const hasVariantFilter = (f?: SongVariantFilter): boolean =>
  f != null && (f.bpm_min != null || f.bpm_max != null || (f.key != null && f.key !== ""));

/** Normalised filter values: undefined bounds become NULL so they no-op in SQL. */
const filterArgs = (f: SongVariantFilter) => ({
  bpmMin: f.bpm_min ?? null,
  bpmMax: f.bpm_max ?? null,
  key: f.key != null && f.key !== "" ? f.key : null,
});

/** Fuzzy title search using the pg_trgm similarity index (Phase 3.1 fallback). */
export async function searchSongsByTitle(
  sql: Executor,
  q: string,
  limit = 20,
  offset = 0,
  filter?: SongVariantFilter,
): Promise<Song[]> {
  if (hasVariantFilter(filter)) {
    // The bpm/key filter constrains on the song's variants via EXISTS, applied
    // INSIDE the windowed query (before limit/offset) so paging stays correct.
    // Each bound is NULL-guarded so an unset bound never excludes a row.
    const { bpmMin, bpmMax, key } = filterArgs(filter!);
    return await sql<Song[]>`
      select * from song
      where canonical_title ilike ${"%" + q + "%"}
        and exists (
          select 1 from song_variant v
          where v.song_id = song.id
            and (${bpmMin}::int is null or v.bpm >= ${bpmMin}::int)
            and (${bpmMax}::int is null or v.bpm <= ${bpmMax}::int)
            and (${key}::text is null or lower(v.key) = lower(${key}::text))
        )
      order by similarity(canonical_title, ${q}) desc, popularity_score desc
      limit ${limit} offset ${offset}
    `;
  }
  return await sql<Song[]>`
    select * from song
    where canonical_title ilike ${"%" + q + "%"}
    order by similarity(canonical_title, ${q}) desc, popularity_score desc
    limit ${limit} offset ${offset}
  `;
}

/**
 * Count the candidate matches for the trigram-fallback title search. Uses the
 * EXACT predicate `searchSongsByTitle` windows over (`canonical_title ILIKE
 * '%q%'`), so the count is the population the (limit, offset) page draws from —
 * a page-stable `total` for the offline fallback. It is a candidate count: the
 * route's Nordic-aware re-ranker may drop a few substring-only hits, so it is a
 * slight superset of the rendered hits, but it is monotonic and page-stable.
 */
export async function countSongsByTitle(
  sql: Executor,
  q: string,
  filter?: SongVariantFilter,
): Promise<number> {
  if (hasVariantFilter(filter)) {
    // Mirror `searchSongsByTitle`'s predicate EXACTLY so the count remains the
    // population the page window draws from — page-stable under bpm/key filters.
    const { bpmMin, bpmMax, key } = filterArgs(filter!);
    const rows = await sql<Array<{ count: number }>>`
      select count(*)::int as count from song
      where canonical_title ilike ${"%" + q + "%"}
        and exists (
          select 1 from song_variant v
          where v.song_id = song.id
            and (${bpmMin}::int is null or v.bpm >= ${bpmMin}::int)
            and (${bpmMax}::int is null or v.bpm <= ${bpmMax}::int)
            and (${key}::text is null or lower(v.key) = lower(${key}::text))
        )
    `;
    return Number(rows[0]?.count ?? 0);
  }
  const rows = await sql<Array<{ count: number }>>`
    select count(*)::int as count from song
    where canonical_title ilike ${"%" + q + "%"}
  `;
  return Number(rows[0]?.count ?? 0);
}

export async function listSongs(sql: Executor, limit = 50): Promise<Song[]> {
  return await sql<Song[]>`select * from song order by created_at desc limit ${limit}`;
}

export async function getSongsByIds(sql: Executor, ids: string[]): Promise<Song[]> {
  if (ids.length === 0) return [];
  return await sql<Song[]>`select * from song where id in ${sql(ids)}`;
}
