/**
 * Sync worker entrypoint.
 *
 *   bun run src/sync.ts [connectorName]   # defaults to "test"
 *
 * Runs one connector pass through the orchestrator with structured logging.
 * The upsert is an in-memory stub today: the real one (write to `song` +
 * `song_variant`, conflict on `source_external_id`) arrives with the
 * repository layer in Phase 1.2.
 */

import { runSync, type NormalizedSong } from "@sundaysong/connectors";
import { jsonLogger } from "./logger";
import { getConnector } from "./registry";

async function main(): Promise<void> {
  const name = process.argv[2] ?? "test";
  const connector = getConnector(name);

  // TODO Phase 1.2 — replace with a repository-backed upsert.
  const store = new Map<string, NormalizedSong>();
  const upsert = async (song: NormalizedSong): Promise<"added" | "updated"> => {
    const key = `${song.source}:${song.source_external_id}`;
    const isNew = !store.has(key);
    store.set(key, song);
    return isNew ? "added" : "updated";
  };

  const { run, deadLetter } = await runSync(connector, { upsert, logger: jsonLogger });

  jsonLogger.info("sync_summary", {
    source: run.source,
    status: run.status,
    added: run.songs_added,
    updated: run.songs_updated,
    dead_letter: deadLetter.length,
    duration_ms: (run.finished_at_ms ?? 0) - run.started_at_ms,
  });

  // Non-zero exit when nothing got through, so a scheduler can alert.
  process.exit(run.status === "failed" ? 1 : 0);
}

main().catch((err) => {
  jsonLogger.error("sync_crashed", { message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
