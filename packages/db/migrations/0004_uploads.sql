-- SundaySong migration 0004 — user-upload moderation lifecycle (Phase 8)
-- Every `POST /v1/songs` contribution lands here in `pending` and is carried
-- through the moderation state machine (`@sundaysong/shared/moderation`) by the
-- admin dashboard. The song row is the canonical catalog identity; the `upload`
-- row is the moderation envelope around it — who submitted it, where it is in
-- the queue, and the running history of moderator decisions.
--
-- Column set matches the `UploadRecord` wire shape the admin route hydrates
-- (`postgresAdminStore` in apps/api), plus a `moderator_notes` jsonb array that
-- keeps the full decision trail (the scalar `moderator_note` is the latest one,
-- denormalised so the existing list/detail queries stay a single table read).

create table public.upload (
  id                uuid primary key default gen_random_uuid(),
  song_id           uuid not null references public.song(id) on delete cascade,
  -- contributor_id crosses Sunday products (owned by the account system), so it
  -- is a thin reference, not a foreign key — same convention as church_id.
  contributor_id    uuid,
  title             text not null,
  language          text not null,
  copyright_status  text not null default 'unknown'
    check (copyright_status in ('public_domain','copyrighted','unknown')),
  submitted_by      text not null default 'anonymous',
  submitted_at      timestamptz not null default now(),
  status            text not null default 'pending'
    check (status in ('pending','approved','rejected','changes_requested','resubmitted')),
  -- Latest moderator note (rejection reason / change request), denormalised for
  -- the queue + detail reads. NULL until a moderator acts.
  moderator_note    text,
  -- Append-only decision trail: [{ "action", "status", "note", "at" }, ...].
  moderator_notes   jsonb not null default '[]'::jsonb,
  updated_at        timestamptz not null default now()
);

-- The moderation queue is read "newest pending first" and filtered by status,
-- so index both the status filter and the submission order.
create index upload_status_idx        on public.upload (status);
create index upload_submitted_at_idx  on public.upload (submitted_at desc);
create index upload_song_idx          on public.upload (song_id);

-- Reuse the trigger function defined in 0001.
create trigger set_updated_at_upload
  before update on public.upload
  for each row execute function public.set_updated_at();

-- Aggregate upload counts by status — the analytics dashboard's queue summary.
-- A view (not a stored proc) so it composes in plain selects and stays a single
-- source of truth for the status histogram.
create view public.upload_status_counts as
  select status, count(*)::int as count
  from public.upload
  group by status;
