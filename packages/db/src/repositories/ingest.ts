import type { Sql } from "../sql";
import type { Executor } from "./types";
import { upsertSource, type SourceKind } from "./sources";
import { insertSong, updateSong, type SongInput } from "./songs";
import { upsertVariant } from "./variants";

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

    if (existing[0]) {
      await updateSong(tx, existing[0].song_id, input.song);
      const v = await upsertVariant(tx, {
        ...input.variant,
        song_id: existing[0].song_id,
        source_id: source.id,
        source_external_id: input.source_external_id,
      });
      return { song_id: existing[0].song_id, variant_id: v.id, action: "updated" };
    }

    const song = await insertSong(tx, input.song);
    const v = await upsertVariant(tx, {
      ...input.variant,
      song_id: song.id,
      source_id: source.id,
      source_external_id: input.source_external_id,
    });
    return { song_id: song.id, variant_id: v.id, action: "added" };
  });
}
