/**
 * Moderation approval workflow — re-exported from `@sundaysong/shared`.
 *
 * The pure state machine moved into the shared package (Phase 8/9) so the API
 * route handler (`apps/api/src/routes/admin.ts`) and this admin UI share one
 * source of truth and can never drift. This module preserves the original
 * `./moderation` import path the dashboard + tests use.
 */

export {
  ACTIVE_STATUSES,
  allowedActions,
  applyAction,
  canApply,
  isActionable,
  requiresNote,
} from "@sundaysong/shared";

export type {
  ApplyResult,
  ModerationAction,
  UploadRecord,
  UploadStatus,
} from "@sundaysong/shared";
