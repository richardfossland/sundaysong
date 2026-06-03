/**
 * `@sundaysong/admin` — the internal moderation + oversight dashboard.
 *
 * Phase 8 (user contributions) and Phase 9 (beta launch) need a place to triage
 * pending uploads, watch source-sync health, and read coverage analytics. This
 * is a Next.js app; everything route-guarded behind the Sunday admin JWT.
 *
 * The barrel re-exports the framework-free pieces (the moderation state machine
 * + the API client) so they can be imported by tests and by the API route
 * handlers without pulling in React.
 */

export {
  applyAction,
  allowedActions,
  canApply,
  isActionable,
  requiresNote,
  ACTIVE_STATUSES,
} from "./lib/moderation";
export type { ModerationAction, UploadStatus, UploadRecord, ApplyResult } from "./lib/moderation";

export { AdminClient, AdminApiError } from "./lib/adminClient";
export type {
  AdminClientConfig,
  SourceSyncRun,
  AnalyticsSummary,
  ModerateResult,
} from "./lib/adminClient";
