import type { ModerationAction, UploadRecord, UploadStatus } from "@sundaysong/shared";
import type { Executor } from "./types";

/**
 * Upload moderation repository (Phase 8).
 *
 * The `upload` row (migration 0004) is the moderation envelope around a
 * catalog song: who submitted it, where it sits in the queue, and an
 * append-only trail of moderator decisions. These functions mirror the
 * `AdminStore`/`AdminClient` contract the admin dashboard consumes — the wire
 * shape is the shared `UploadRecord`, so the route handler can hand rows
 * straight through without remapping.
 *
 * The state-machine itself (legal transitions, note-required rules) lives in
 * `@sundaysong/shared` (`applyAction`); this layer only persists the decision a
 * caller has already validated.
 */

/** What a contributor declares about an upload when it is first created. */
export interface CreateUploadInput {
  song_id: string;
  title: string;
  language: string;
  copyright_status?: UploadRecord["copyright_status"];
  /** Display name of the contributor, for the queue. */
  submitted_by?: string;
  /** Account id of the contributor (crosses Sunday products). */
  contributor_id?: string | null;
}

/** One entry in the append-only moderator decision trail. */
export interface ModerationNote {
  action: ModerationAction;
  status: UploadStatus;
  note: string | null;
  at: string;
}

// The columns that hydrate a `UploadRecord`. `submitted_at` is cast to text so
// it stays an ISO string (Bun.SQL otherwise hydrates timestamptz into a JS
// Date). Inlined per query, matching the admin route's `postgresAdminStore`.

/** Create the moderation envelope for a freshly-contributed song. Starts `pending`. */
export async function createUpload(sql: Executor, input: CreateUploadInput): Promise<UploadRecord> {
  const rows = await sql<UploadRecord[]>`
    insert into upload (
      song_id, title, language, copyright_status, submitted_by, contributor_id
    ) values (
      ${input.song_id}, ${input.title}, ${input.language},
      ${input.copyright_status ?? "unknown"}, ${input.submitted_by ?? "anonymous"},
      ${input.contributor_id ?? null}
    )
    returning id, song_id, title, language, submitted_by,
              submitted_at::text as submitted_at, status,
              moderator_note, copyright_status
  `;
  return rows[0]!;
}

/** The moderation queue — newest first, optionally filtered by status. */
export async function listUploadsByStatus(sql: Executor, status?: UploadStatus): Promise<UploadRecord[]> {
  if (status) {
    return await sql<UploadRecord[]>`
      select id, song_id, title, language, submitted_by,
             submitted_at::text as submitted_at, status,
             moderator_note, copyright_status
      from upload where status = ${status}
      order by submitted_at desc
    `;
  }
  return await sql<UploadRecord[]>`
    select id, song_id, title, language, submitted_by,
           submitted_at::text as submitted_at, status,
           moderator_note, copyright_status
    from upload order by submitted_at desc
  `;
}

/** One upload by id, or null when it doesn't exist. */
export async function getUpload(sql: Executor, id: string): Promise<UploadRecord | null> {
  const rows = await sql<UploadRecord[]>`
    select id, song_id, title, language, submitted_by,
           submitted_at::text as submitted_at, status,
           moderator_note, copyright_status
    from upload where id = ${id}
  `;
  return rows[0] ?? null;
}

/**
 * Persist a moderation decision: set the new status, surface the note as the
 * latest `moderator_note`, AND append `{ action, status, note, at }` to the
 * `moderator_notes` history in one statement. The transition is assumed
 * already validated by `applyAction`; this is pure persistence.
 */
export async function updateUploadStatus(
  sql: Executor,
  id: string,
  status: UploadStatus,
  action: ModerationAction,
  note?: string,
): Promise<void> {
  const entry: ModerationNote = { action, status, note: note ?? null, at: new Date().toISOString() };
  // Append via jsonb_build_array so we pass `entry` as a single jsonb OBJECT —
  // Bun.SQL would otherwise serialize a JS array into a Postgres array literal
  // (the same gotcha encode.ts documents for text[]), corrupting the history.
  await sql`
    update upload set
      status = ${status},
      moderator_note = ${note ?? null},
      moderator_notes = moderator_notes || jsonb_build_array(${entry}::jsonb)
    where id = ${id}
  `;
}

/**
 * Append a free-standing note to an upload's history without changing its
 * status (e.g. an internal moderator comment). Also refreshes the scalar
 * `moderator_note` so the queue shows the latest context.
 */
export async function addModerationNote(sql: Executor, id: string, note: string): Promise<void> {
  const current = await getUpload(sql, id);
  const status = current?.status ?? "pending";
  const entry: ModerationNote = { action: "request_changes", status, note, at: new Date().toISOString() };
  await sql`
    update upload set
      moderator_note = ${note},
      moderator_notes = moderator_notes || jsonb_build_array(${entry}::jsonb)
    where id = ${id}
  `;
}

/** Full decision trail for an upload (oldest first). */
export async function moderationHistory(sql: Executor, id: string): Promise<ModerationNote[]> {
  const rows = await sql<Array<{ moderator_notes: ModerationNote[] }>>`
    select moderator_notes from upload where id = ${id}
  `;
  return rows[0]?.moderator_notes ?? [];
}

/** Upload counts grouped by status — the analytics queue summary (view 0004). */
export async function uploadCountsByStatus(sql: Executor): Promise<Record<string, number>> {
  const rows = await sql<Array<{ status: string; count: number }>>`
    select status, count from upload_status_counts
  `;
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
}
