import type { Song } from "@sundaysong/shared";
import type { Executor } from "./types";
import { toPgVector } from "./encode";

export type EmbeddingEntity = "song" | "variant";

export interface UpsertEmbeddingInput {
  entity_type: EmbeddingEntity;
  entity_id: string;
  vector: number[];
  model_version: string;
}

/** Store (or replace) an entity's embedding for a given model version. */
export async function upsertEmbedding(sql: Executor, input: UpsertEmbeddingInput): Promise<void> {
  await sql`
    insert into embedding (entity_type, entity_id, vector, model_version)
    values (${input.entity_type}, ${input.entity_id}, ${toPgVector(input.vector)}::vector, ${input.model_version})
    on conflict (entity_type, entity_id, model_version)
    do update set vector = excluded.vector, created_at = now()
  `;
}

export interface NearestSong extends Song {
  /** Cosine similarity in [0,1] — higher is closer. */
  score: number;
}

export interface NearestSongsInput {
  vector: number[];
  k: number;
  model_version: string;
  language?: string;
}

/**
 * The k nearest songs to a query vector via the pgvector HNSW cosine index.
 * `<=>` is cosine distance (0 = identical), so similarity = 1 - distance.
 */
export async function nearestSongs(sql: Executor, input: NearestSongsInput): Promise<NearestSong[]> {
  const vec = toPgVector(input.vector);
  if (input.language) {
    return await sql<NearestSong[]>`
      select s.*, 1 - (e.vector <=> ${vec}::vector) as score
      from embedding e join song s on s.id = e.entity_id
      where e.entity_type = 'song' and e.model_version = ${input.model_version}
        and s.original_language = ${input.language}
      order by e.vector <=> ${vec}::vector
      limit ${input.k}
    `;
  }
  return await sql<NearestSong[]>`
    select s.*, 1 - (e.vector <=> ${vec}::vector) as score
    from embedding e join song s on s.id = e.entity_id
    where e.entity_type = 'song' and e.model_version = ${input.model_version}
    order by e.vector <=> ${vec}::vector
    limit ${input.k}
  `;
}

/** Songs that don't yet have an embedding for the given model — for the worker. */
export async function songsMissingEmbedding(sql: Executor, modelVersion: string, limit = 1000): Promise<Song[]> {
  return await sql<Song[]>`
    select s.* from song s
    where not exists (
      select 1 from embedding e
      where e.entity_type = 'song' and e.entity_id = s.id and e.model_version = ${modelVersion}
    )
    order by s.created_at
    limit ${limit}
  `;
}
