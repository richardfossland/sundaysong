/**
 * Search reindex worker.
 *
 *   bun run src/index-songs.ts
 *
 * Reads every song + its variants from Postgres, flattens them into search
 * documents, and rebuilds the Meilisearch `songs` index. Run after an import.
 * Requires both Postgres and Meilisearch (pnpm db:up).
 */

import { getSql, listSongs, listVariantsForSong } from "@sundaysong/db";
import { MeiliClient, reindexSongs, songToSearchDoc, type SongDoc } from "@sundaysong/search";
import { jsonLogger } from "./logger";

async function main(): Promise<void> {
  const sql = getSql();
  const meili = new MeiliClient();
  try {
    const songs = await listSongs(sql, 100_000);
    const docs: SongDoc[] = [];
    for (const song of songs) {
      const variants = await listVariantsForSong(sql, song.id);
      docs.push(songToSearchDoc(song, variants));
    }
    await reindexSongs(meili, docs);
    jsonLogger.info("reindex_done", { indexed: docs.length });
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  jsonLogger.error("reindex_failed", { message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
