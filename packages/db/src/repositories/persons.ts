import type { Executor } from "./types";

export interface PersonRow {
  id: string;
  display_name: string;
}

/** Find-or-create a person by display name (deduped via the 0003 unique index). */
export async function upsertPerson(sql: Executor, displayName: string): Promise<PersonRow> {
  const rows = await sql<PersonRow[]>`
    insert into person (display_name) values (${displayName})
    on conflict (display_name) do update set display_name = excluded.display_name
    returning id, display_name
  `;
  return rows[0]!;
}

/** Link a person as a lyricist of a song. Idempotent. */
export async function linkLyricist(sql: Executor, songId: string, personId: string): Promise<void> {
  await sql`
    insert into song_lyricist (song_id, person_id) values (${songId}, ${personId})
    on conflict do nothing
  `;
}

export async function lyricistsForSong(sql: Executor, songId: string): Promise<PersonRow[]> {
  return await sql<PersonRow[]>`
    select p.id, p.display_name
    from song_lyricist sl join person p on p.id = sl.person_id
    where sl.song_id = ${songId}
    order by p.display_name
  `;
}
