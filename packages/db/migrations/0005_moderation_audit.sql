-- SundaySong migration 0005 — moderation audit trail (Phase 8 / security)
-- NEEDS LIVE SUPABASE DB PUSH: this migration cannot be applied offline; run it
-- against the live database (`pnpm db:migrate`) before the audit writes take
-- effect. The surrounding route + store logic is offline-tested via the
-- in-memory `AdminStore` fake (`recordAudit`) — see apps/api/test/admin.test.ts.
--
-- Every moderation decision (`POST /v1/admin/uploads/:id/moderate`) appends one
-- append-only row here AFTER the decision lands, so a rejection or approval can
-- always be traced back to WHO decided, WHAT they did, and WHEN. The scalar
-- `upload.moderator_note` only keeps the latest note; this is the full history.
--
-- Behaviour-preserving: this is a brand-new table with sensible DEFAULTs; no
-- existing column changes, so applying it leaves the current moderation flow
-- working unchanged (the route simply also writes a row from now on).

create table public.moderation_audit (
  id          uuid primary key default gen_random_uuid(),
  upload_id   uuid not null references public.upload(id) on delete cascade,
  -- The Sunday account id (JWT `sub`) of the moderator, or 'anonymous' in dev /
  -- when platform auth isn't configured. A thin reference, not a foreign key —
  -- the account system owns the identity (same convention as contributor_id).
  moderator   text not null default 'anonymous',
  action      text not null
    check (action in ('approve','reject','request_changes','resubmit','reopen')),
  -- The status the upload landed in after the action.
  status      text not null
    check (status in ('pending','approved','rejected','changes_requested','resubmitted')),
  note        text,
  created_at  timestamptz not null default now()
);

-- The trail is read per-upload (the decision history for one contribution) and
-- chronologically across the platform — index both access paths.
create index moderation_audit_upload_idx  on public.moderation_audit (upload_id);
create index moderation_audit_created_idx on public.moderation_audit (created_at desc);
