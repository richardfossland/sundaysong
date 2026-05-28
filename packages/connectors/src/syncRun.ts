/**
 * Sync-run state machine.
 *
 * A run tracks what one connector pass did: how many songs it added/updated
 * and which records were dead-lettered. The final status is derived, not set
 * by hand: clean run = succeeded, made progress but hit dead-letters = partial,
 * progressed on nothing = failed.
 */

import type { SyncError, SyncRunState, SyncStatus } from "./types";

export function startRun(source: string, nowMs: number): SyncRunState {
  return {
    source,
    status: "running",
    started_at_ms: nowMs,
    songs_added: 0,
    songs_updated: 0,
    errors: [],
  };
}

export function recordAdded(state: SyncRunState): SyncRunState {
  return { ...state, songs_added: state.songs_added + 1 };
}

export function recordUpdated(state: SyncRunState): SyncRunState {
  return { ...state, songs_updated: state.songs_updated + 1 };
}

export function recordError(state: SyncRunState, error: SyncError): SyncRunState {
  return { ...state, errors: [...state.errors, error] };
}

export function finishRun(state: SyncRunState, nowMs: number): SyncRunState {
  const progressed = state.songs_added + state.songs_updated > 0;
  let status: SyncStatus;
  if (state.errors.length === 0) status = "succeeded";
  else if (progressed) status = "partial";
  else status = "failed";
  return { ...state, status, finished_at_ms: nowMs };
}
