-- SundaySong migration 0002 — church licensing profile
-- Per-church CCLI + TONO subscription state. church_id crosses Sunday products
-- (a church is owned by the account system), so this is a thin profile keyed by
-- that id, not a full church entity. Drives the licensing report + coverage.

create table public.church_licensing (
  church_id             uuid primary key,
  ccli_license_number   text,
  ccli_size_category    text check (ccli_size_category in ('A','B','C','D','E','F')),
  ccli_streaming_addon  boolean not null default false,
  tono_license_status   text not null default 'none'
    check (tono_license_status in ('none','state_church_blanket','direct_agreement','application_pending','not_applicable')),
  tono_customer_id      text,
  tono_streaming_addon  boolean not null default false,
  denomination          text not null default 'other'
    check (denomination in ('den_norske_kirke','frikirke','pinse','baptist','metodist','other')),
  updated_at            timestamptz not null default now()
);

-- Reuse the trigger function defined in 0001.
create trigger set_updated_at_church_licensing
  before update on public.church_licensing
  for each row execute function public.set_updated_at();
