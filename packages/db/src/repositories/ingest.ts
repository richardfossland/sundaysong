import type { Sql } from "../sql";
import type { Executor } from "./types";
import { upsertSource, type SourceKind } from "./sources";
import { insertSong, updateSong, type SongInput } from "./songs";
import { upsertVariant } from "./variants";
import { upsertPerson, linkLyricist } from "./persons";
import { createUpload } from "./uploads";

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
    chord_chart_url?: string | null;
    attribution_text?: string | null;
  };
  /** Lyricist display names — find-or-created and linked (idempotent). */
  lyricists?: string[];
  /**
   * Present only for user contributions (`POST /v1/songs`): also open a Phase 8
   * moderation envelope around the song so it enters the admin queue as
   * `pending`. Connector imports omit this — their content is already trusted.
   */
  upload?: {
    submitted_by?: string;
    contributor_id?: string | null;
  };
}

export interface UpsertResult {
  song_id: string;
  variant_id: string;
  action: "added" | "updated";
  /** The moderation envelope id, when `input.upload` requested one. */
  upload_id?: string;
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

    let uploadId: string | undefined;
    if (input.upload) {
      const upload = await createUpload(tx, {
        song_id: songId,
        title: input.variant.title,
        language: input.variant.language,
        copyright_status: input.song.copyright_status,
        submitted_by: input.upload.submitted_by,
        contributor_id: input.upload.contributor_id,
      });
      uploadId = upload.id;
    }

    return {
      song_id: songId,
      variant_id: v.id,
      action: existing[0] ? "updated" : "added",
      upload_id: uploadId,
    };
  });
}
