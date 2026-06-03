"use client";

import { useState } from "react";

import { allowedActions, applyAction, requiresNote } from "../lib/moderation";
import type { ModerationAction, UploadRecord, UploadStatus } from "../lib/moderation";

/**
 * The moderation queue. Renders each pending/recent upload with the actions
 * that are legal *from its current status* (driven by the shared state
 * machine, so the UI can never offer an illegal transition), and an optimistic
 * status update on click. `onModerate` performs the real API call; on failure
 * the row reverts to its prior status and the error is shown.
 */

const ACTION_LABEL: Record<ModerationAction, string> = {
  approve: "Approve",
  reject: "Reject",
  request_changes: "Request changes",
  resubmit: "Resubmit",
  reopen: "Reopen",
};

const STATUS_LABEL: Record<UploadStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  changes_requested: "Changes requested",
  resubmitted: "Resubmitted",
};

export interface UploadListProps {
  uploads: UploadRecord[];
  /** Persist a moderation decision. Resolves on success, rejects on API error. */
  onModerate: (uploadId: string, action: ModerationAction, note?: string) => Promise<void>;
}

interface RowState {
  status: UploadStatus;
  busy: boolean;
  error?: string;
}

export function UploadList({ uploads, onModerate }: UploadListProps) {
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(uploads.map((u) => [u.id, { status: u.status, busy: false }])),
  );
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function act(upload: UploadRecord, action: ModerationAction) {
    const current = rows[upload.id]?.status ?? upload.status;
    const note = notes[upload.id];

    // Validate against the shared state machine before touching the network.
    const result = applyAction(current, action, note);
    if (!result.ok) {
      setRows((r) => ({ ...r, [upload.id]: { status: current, busy: false, error: result.error } }));
      return;
    }

    // Optimistic: show the new status while the request is in flight.
    setRows((r) => ({ ...r, [upload.id]: { status: result.status, busy: true } }));
    try {
      await onModerate(upload.id, action, note);
      setRows((r) => ({ ...r, [upload.id]: { status: result.status, busy: false } }));
    } catch (e) {
      setRows((r) => ({
        ...r,
        [upload.id]: { status: current, busy: false, error: e instanceof Error ? e.message : "Failed." },
      }));
    }
  }

  if (uploads.length === 0) {
    return <p className="empty">No uploads in this view.</p>;
  }

  return (
    <ul className="upload-list">
      {uploads.map((u) => {
        const state = rows[u.id] ?? { status: u.status, busy: false };
        const actions = allowedActions(state.status);
        return (
          <li key={u.id} className="upload-row" data-status={state.status}>
            <div className="upload-head">
              <h3>{u.title}</h3>
              <span className="status-tag">{STATUS_LABEL[state.status]}</span>
              <span className="lang-tag">{u.language}</span>
              {u.copyright_status === "copyrighted" && <span className="warn-tag">copyrighted</span>}
            </div>
            <p className="upload-meta">
              by {u.submitted_by} · {new Date(u.submitted_at).toLocaleDateString()}
            </p>
            {u.moderator_note && <p className="upload-note">Note: {u.moderator_note}</p>}

            {actions.length > 0 && (
              <div className="upload-actions">
                {actions.some((a) => requiresNote(a)) && (
                  <input
                    className="note-input"
                    placeholder="Reason / change request…"
                    value={notes[u.id] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [u.id]: e.target.value }))}
                  />
                )}
                {actions.map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={`btn btn-${a}`}
                    disabled={state.busy}
                    onClick={() => act(u, a)}
                  >
                    {ACTION_LABEL[a]}
                  </button>
                ))}
              </div>
            )}

            {state.error && <p className="err">⚠ {state.error}</p>}
          </li>
        );
      })}
    </ul>
  );
}
