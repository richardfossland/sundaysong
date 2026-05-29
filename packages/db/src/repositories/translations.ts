import type { Executor } from "./types";

export type TranslationRelationship = "official" | "unofficial" | "adaptation" | "paraphrase";
export type TranslationVerifiedBy = "admin" | "community" | "ai_with_review";

export interface LinkTranslationInput {
  source_song_id: string;
  target_song_id: string;
  relationship: TranslationRelationship;
  attribution?: string | null;
  verified_by?: TranslationVerifiedBy;
}

/** A translation of a song, as seen from one song's point of view. */
export interface TranslationLink {
  /** The *other* song in the relationship. */
  song_id: string;
  title: string;
  language: string;
  relationship: TranslationRelationship;
  attribution: string | null;
  /** "to" = the other song is a translation of this one; "from" = vice-versa. */
  direction: "to" | "from";
}

/** Link two songs as a translation pair. Idempotent on (source, target). */
export async function linkTranslation(sql: Executor, input: LinkTranslationInput): Promise<void> {
  await sql`
    insert into translation (source_song_id, target_song_id, relationship, attribution, verified_by, verified_at)
    values (
      ${input.source_song_id}, ${input.target_song_id}, ${input.relationship},
      ${input.attribution ?? null}, ${input.verified_by ?? "admin"}, now()
    )
    on conflict (source_song_id, target_song_id) do update set
      relationship = excluded.relationship,
      attribution  = excluded.attribution,
      verified_by  = excluded.verified_by
  `;
}

/**
 * Every song linked as a translation of `songId`, in both directions — so a
 * worship leader searching the English original finds the Norwegian version
 * and vice-versa. Sorted official-first, then by language.
 */
export async function translationsForSong(sql: Executor, songId: string): Promise<TranslationLink[]> {
  return await sql<TranslationLink[]>`
    select * from (
      select s.id as song_id, s.canonical_title as title, s.original_language as language,
             t.relationship, t.attribution, 'to' as direction
      from translation t join song s on s.id = t.target_song_id
      where t.source_song_id = ${songId}
      union all
      select s.id as song_id, s.canonical_title as title, s.original_language as language,
             t.relationship, t.attribution, 'from' as direction
      from translation t join song s on s.id = t.source_song_id
      where t.target_song_id = ${songId}
    ) u
    order by
      case u.relationship when 'official' then 0 when 'unofficial' then 1 when 'adaptation' then 2 else 3 end,
      u.language
  `;
}

/** Bulk variant for hydrating search results without N round-trips. */
export async function translationsForSongs(
  sql: Executor,
  songIds: string[],
): Promise<Map<string, TranslationLink[]>> {
  const out = new Map<string, TranslationLink[]>();
  if (songIds.length === 0) return out;
  const rows = await sql<Array<TranslationLink & { owner_id: string }>>`
    select t.source_song_id as owner_id, s.id as song_id, s.canonical_title as title,
           s.original_language as language, t.relationship, t.attribution, 'to' as direction
    from translation t join song s on s.id = t.target_song_id
    where t.source_song_id in ${sql(songIds)}
    union all
    select t.target_song_id as owner_id, s.id as song_id, s.canonical_title as title,
           s.original_language as language, t.relationship, t.attribution, 'from' as direction
    from translation t join song s on s.id = t.source_song_id
    where t.target_song_id in ${sql(songIds)}
  `;
  for (const r of rows) {
    const { owner_id, ...link } = r;
    const list = out.get(owner_id) ?? [];
    list.push(link);
    out.set(owner_id, list);
  }
  return out;
}
