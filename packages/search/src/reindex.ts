import type { MeiliClient } from "./client";
import { SONG_INDEX } from "./config";
import { SONG_INDEX_SETTINGS, type SongDoc } from "./songDoc";

/**
 * (Re)build the song index: ensure it exists with `id` as primary key, push the
 * settings, then upsert the documents. Each step waits for its Meili task so the
 * index is queryable when this resolves.
 */
export async function reindexSongs(meili: MeiliClient, docs: SongDoc[], uid: string = SONG_INDEX): Promise<void> {
  await meili.ensureIndex(uid, "id");
  const settingsTask = await meili.updateSettings(uid, SONG_INDEX_SETTINGS);
  await meili.waitForTask(settingsTask.taskUid);
  if (docs.length > 0) {
    const docsTask = await meili.addDocuments(uid, docs);
    await meili.waitForTask(docsTask.taskUid);
  }
}
