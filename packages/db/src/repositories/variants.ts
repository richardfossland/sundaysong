import type { SongVariant } from "@sundaysong/shared";
import type { Executor } from "./types";

export interface VariantInput {
  song_id: string;
  source_id: string;
  source_external_id: string | null;
  title: string;
  language: string;
  key?: string | null;
  lyrics_url?: string | null;
  lyrics_excerpt?: string | null;
  chord_chart_url?: string | null;
  attribution_text?: string | null;
}

/**
 * Insert or update a variant, keyed on (source_id, source_external_id). Returns
 * whether the row was newly created — detected via the `xmax = 0` trick, which
 * is true only for the tuple version produced by an INSERT.
 */
export async function upsertVariant(sql: Executor, input: VariantInput): Promise<{ id: string; created: boolean }> {
  const rows = await sql<Array<{ id: string; created: boolean }>>`
    insert into song_variant (
      song_id, source_id, source_external_id, title, language, key,
      lyrics_url, lyrics_excerpt, chord_chart_url, attribution_text, attribution_required
    ) values (
      ${input.song_id}, ${input.source_id}, ${input.source_external_id}, ${input.title},
      ${input.language}, ${input.key ?? null}, ${input.lyrics_url ?? null},
      ${input.lyrics_excerpt ?? null}, ${input.chord_chart_url ?? null}, ${input.attribution_text ?? null}, true
    )
    on conflict (source_id, source_external_id) do update set
      title = excluded.title,
      language = excluded.language,
      key = excluded.key,
      lyrics_url = excluded.lyrics_url,
      lyrics_excerpt = excluded.lyrics_excerpt,
      chord_chart_url = excluded.chord_chart_url,
      attribution_text = excluded.attribution_text,
      last_verified_at = now()
    returning id, (xmax = 0) as created
  `;
  return rows[0]!;
}

export async function listVariantsForSong(sql: Executor, songId: string): Promise<SongVariant[]> {
  return await sql<SongVariant[]>`
    select * from song_variant where song_id = ${songId} order by imported_at
  `;
}
