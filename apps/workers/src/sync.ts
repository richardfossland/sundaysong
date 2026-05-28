/**
 * Sync worker entrypoint.
 *
 *   bun run src/sync.ts [connectorName]   # defaults to "test"
 *
 * Runs one connector pass through the orchestrator with structured logging,
 * upserting each normalized song into Postgres via the repository layer
 * (idempotent on source_external_id). Requires a running database (pnpm db:up).
 */

import { runSync, type NormalizedSong } from "@sundaysong/connectors";
import { getSql, upsertSongWithVariant } from "@sundaysong/db";
import { jsonLogger } from "./logger";
import { getConnector } from "./registry";

async function main(): Promise<void> {
  const name = process.argv[2] ?? "test";
  const connector = getConnector(name);
  const sql = getSql();

  const upsert = async (song: NormalizedSong): Promise<"added" | "updated"> => {
    const result = await upsertSongWithVariant(sql, {
      source_name: song.source,
      source_external_id: song.source_external_id,
      song: {
        canonical_title: song.canonical_title,
        original_language: song.original_language,
        copyright_status: song.copyright_status,
        year_first_published: song.year_first_published ?? null,
        ccli_song_id: song.ccli_song_id ?? null,
        tono_work_id: song.tono_work_id ?? null,
        hymnary_id: song.hymnary_id ?? null,
        themes: song.themes ?? [],
      },
      variant: {
        title: song.variant.title,
        language: song.variant.language,
        key: song.variant.key ?? null,
        lyrics_url: song.variant.lyrics_url ?? null,
        lyrics_excerpt: song.variant.lyrics_excerpt ?? null,
        attribution_text: song.variant.attribution_text,
      },
    });
    return result.action;
  };

  let exitCode = 0;
  try {
    const { run, deadLetter } = await runSync(connector, { upsert, logger: jsonLogger });
    jsonLogger.info("sync_summary", {
      source: run.source,
      status: run.status,
      added: run.songs_added,
      updated: run.songs_updated,
      dead_letter: deadLetter.length,
      duration_ms: (run.finished_at_ms ?? 0) - run.started_at_ms,
    });
    exitCode = run.status === "failed" ? 1 : 0;
  } finally {
    await sql.end();
  }
  process.exit(exitCode);
}

main().catch((err) => {
  jsonLogger.error("sync_crashed", { message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
