/**
 * Moderation approval workflow — the pure state machine behind the admin
 * dashboard (Phase 8 user contributions).
 *
 * Every user upload (`POST /v1/songs` with `license_declaration: true`) lands
 * in `pending`. A moderator can approve it, reject it, or request changes; the
 * contributor can resubmit a `changes_requested` upload, which puts it back in
 * the queue. This module is the single source of truth for which transitions
 * are legal and what each does — it is intentionally framework-free and
 * dependency-free so it can be unit-tested offline and reused by both the API
 * route handler and the React UI without drift.
 */

/** Lifecycle of a user-contributed upload as it moves through moderation. */
export type UploadStatus =
  | "pending" // awaiting first review
  | "approved" // published into the catalog
  | "rejected" // declined; terminal unless an admin reopens
  | "changes_requested" // bounced back to the contributor with notes
  | "resubmitted"; // contributor re-sent; back in the queue

/** What a moderator (or the contributor, for `resubmit`) can do to an upload. */
export type ModerationAction = "approve" | "reject" | "request_changes" | "resubmit" | "reopen";

/** Which actions are still actionable from a given status (the rest are terminal-ish). */
export const ACTIVE_STATUSES: readonly UploadStatus[] = ["pending", "resubmitted", "changes_requested"];

/**
 * The transition table. A status maps to the actions legal from it, and each
 * action names the status it lands in. Anything not listed is rejected by
 * `applyAction`, which is what keeps the workflow honest.
 */
const TRANSITIONS: Record<UploadStatus, Partial<Record<ModerationAction, UploadStatus>>> = {
  pending: {
    approve: "approved",
    reject: "rejected",
    request_changes: "changes_requested",
  },
  resubmitted: {
    approve: "approved",
    reject: "rejected",
    request_changes: "changes_requested",
  },
  changes_requested: {
    // The contributor resubmits; an admin may also approve/reject directly.
    resubmit: "resubmitted",
    approve: "approved",
    reject: "rejected",
  },
  approved: {
    // Approved is effectively terminal, but an admin can pull it back for review.
    reopen: "pending",
  },
  rejected: {
    // Rejected is effectively terminal, but an admin can reopen on appeal.
    reopen: "pending",
  },
};

/** Actions that REQUIRE a note (so the contributor knows why). */
const NOTE_REQUIRED: readonly ModerationAction[] = ["reject", "request_changes"];

export interface UploadRecord {
  id: string;
  song_id: string;
  title: string;
  language: string;
  submitted_by: string;
  submitted_at: string;
  status: UploadStatus;
  /** Most recent moderator note, if any (rejection reason / change request). */
  moderator_note?: string | null;
  copyright_status: "public_domain" | "copyrighted" | "unknown";
}

export interface ApplyResult {
  ok: boolean;
  /** The resulting status when ok; the unchanged status when not. */
  status: UploadStatus;
  /** Human-readable reason when `ok` is false. */
  error?: string;
}

/** Is `action` legal from `from`? Pure predicate, no side effects. */
export function canApply(from: UploadStatus, action: ModerationAction): boolean {
  return TRANSITIONS[from]?.[action] !== undefined;
}

/** The set of actions a moderator can take from a given status. */
export function allowedActions(from: UploadStatus): ModerationAction[] {
  return Object.keys(TRANSITIONS[from] ?? {}) as ModerationAction[];
}

/** Does this action need an accompanying note to be valid? */
export function requiresNote(action: ModerationAction): boolean {
  return NOTE_REQUIRED.includes(action);
}

/**
 * Apply a moderation action to a status. Returns the next status on success or
 * a structured error (illegal transition, or a missing required note). Never
 * throws — callers branch on `ok` so the UI and the route handler share one set
 * of guarantees.
 */
export function applyAction(from: UploadStatus, action: ModerationAction, note?: string): ApplyResult {
  const next = TRANSITIONS[from]?.[action];
  if (next === undefined) {
    return { ok: false, status: from, error: `Cannot ${action} an upload that is ${from}.` };
  }
  if (requiresNote(action) && !note?.trim()) {
    return { ok: false, status: from, error: `A note is required to ${action.replace("_", " ")}.` };
  }
  return { ok: true, status: next };
}

/** Whether an upload is still waiting on a moderator. */
export function isActionable(status: UploadStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}
