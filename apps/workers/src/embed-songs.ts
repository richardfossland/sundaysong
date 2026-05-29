/**
 * Embedding worker.
 *
 *   bun run src/embed-songs.ts          # embed songs missing a vector
 *   bun run src/embed-songs.ts --all    # re-embed everything (e.g. model bump)
 *
 * Builds each song's embedding text, runs it through the active embedder, and
 * upserts into the `embedding` table. Powers POST /v1/songs/semantic-search.
 * Requires Postgres (pnpm db:up). The default embedder is local + offline.
 */

import { getSql, listSongs, listVariantsForSong, songsMissingEmbedding, upsertEmbedding } from "@sundaysong/db";
import { getEmbedder, songEmbeddingText } from "@sundaysong/ai";
import { jsonLogger } from "./logger";

async function main(): Promise<void> {
  const all = process.argv.includes("--all");
  const sql = getSql();
  const embedder = getEmbedder();
  try {
    const songs = all ? await listSongs(sql, 100_000) : await songsMissingEmbedding(sql, embedder.modelVersion, 100_000);
    let done = 0;
    for (const song of songs) {
      const variants = await listVariantsForSong(sql, song.id);
      const text = songEmbeddingText(song, { lyrics_excerpt: variants[0]?.lyrics_excerpt ?? null });
      const [vector] = await embedder.embed([text]);
      await upsertEmbedding(sql, {
        entity_type: "song",
        entity_id: song.id,
        vector: vector!,
        model_version: embedder.modelVersion,
      });
      done += 1;
    }
    jsonLogger.info("embed_done", { model: embedder.modelVersion, embedded: done, mode: all ? "all" : "missing" });
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  jsonLogger.error("embed_failed", { message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
