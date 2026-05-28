import type { Sql } from "../sql";
import type { Executor } from "./types";
import { upsertSource, type SourceKind } from "./sources";
import { insertSong, updateSong, type SongInput } from "./songs";
import { upsertVariant } from "./variants";
import { upsertPerson, linkLyricist } from "./persons";

export interface UpsertSongWithVariantInput {
  source_name: string;
  source_kind?: SourceKind;
  /** Idempotency anchor — re-importing the same record updates in place. */
  source_external_id: string;
  song: SongInput;
  variant: {
    title: string;
    language: string;
    key?: string | null;
    lyrics_url?: string | null;
    lyrics_excerpt?: string | null;
    attribution_text?: string | null;
  };
  /** Lyricist display names — find-or-created and linked (idempotent). */
  lyricists?: string[];
}

export interface UpsertResult {
  song_id: string;
  variant_id: string;
  action: "added" | "updated";
}

/**
 * Upsert a song + its source variant atomically. The variant's
 * (source_id, source_external_id) is the idempotency key: a second import of
 * the same record updates the existing song/variant rather than duplicating.
 * This is exactly the contract the connector pipeline's `upsert` needs.
 */
export async function upsertSongWithVariant(sql: Sql, input: UpsertSongWithVariantInput): Promise<UpsertResult> {
  return await sql.begin(async (tx: Executor) => {
    const source = await upsertSource(tx, { name: input.source_name, kind: input.source_kind });

    const existing = await tx<Array<{ id: string; song_id: string }>>`
      select id, song_id from song_variant
      where source_id = ${source.id} and source_external_id = ${input.source_external_id}
    `;

    const songId = existing[0]
      ? (await updateSong(tx, existing[0].song_id, input.song), existing[0].song_id)
      : (await insertSong(tx, input.song)).id;

    const v = await upsertVariant(tx, {
      ...input.variant,
      song_id: songId,
      source_id: source.id,
      source_external_id: input.source_external_id,
    });

    for (const name of input.lyricists ?? []) {
      const person = await upsertPerson(tx, name);
      await linkLyricist(tx, songId, person.id);
    }

    return { song_id: songId, variant_id: v.id, action: existing[0] ? "updated" : "added" };
  });
}
