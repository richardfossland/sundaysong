-- SundaySong migration 0001 — core schema
-- Postgres on Supabase. Builds the canonical Song + variants + people +
-- translations + embeddings + usage log. See docs/DOMAIN.md.

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";
create extension if not exists "vector";

-- ── Sources ─────────────────────────────────────────────────────────────────
create table public.source (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null unique,
  kind                  text not null check (kind in ('api','scrape','manual','user_upload')),
  attribution_template  text not null,
  last_sync_at          timestamptz,
  enabled               boolean not null default true,
  created_at            timestamptz not null default now()
);

-- ── Persons (composers, lyricists, translators, performers) ─────────────────
create table public.person (
  id            uuid primary key default gen_random_uuid(),
  display_name  text not null,
  sort_name     text,
  birth_year    int,
  death_year    int,
  nationality   text,
  bio_short     text,
  external_ids  jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index person_sort_idx on public.person (sort_name);
create index person_name_trgm on public.person using gin (display_name gin_trgm_ops);

-- ── Themes (controlled vocabulary) ──────────────────────────────────────────
create table public.theme (
  slug  text primary key,
  name  jsonb not null  -- { "no": "nåde", "en": "grace", ... }
);

-- ── Song (canonical identity) ───────────────────────────────────────────────
create table public.song (
  id                   uuid primary key default gen_random_uuid(),
  canonical_title      text not null,
  original_language    text not null default 'en',
  year_first_published int,
  copyright_status     text not null default 'unknown' check (copyright_status in ('public_domain','copyrighted','unknown')),
  ccli_song_id         text,
  tono_work_id         text,
  tono_registered      boolean not null default false,
  hymnary_id           text,
  popularity_score     numeric not null default 0,
  nordic_metadata      jsonb not null default '{}'::jsonb,
  themes               text[] not null default '{}',
  bible_refs           text[] not null default '{}',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index song_title_trgm     on public.song using gin (canonical_title gin_trgm_ops);
create index song_themes_gin     on public.song using gin (themes);
create index song_bible_gin      on public.song using gin (bible_refs);
create index song_ccli_idx       on public.song (ccli_song_id) where ccli_song_id is not null;
create index song_tono_idx       on public.song (tono_work_id) where tono_work_id is not null;
create index song_lang_idx       on public.song (original_language);

-- Credits — many-to-many
create table public.song_composer (
  song_id    uuid not null references public.song(id) on delete cascade,
  person_id  uuid not null references public.person(id),
  primary key (song_id, person_id)
);
create table public.song_lyricist (
  song_id    uuid not null references public.song(id) on delete cascade,
  person_id  uuid not null references public.person(id),
  primary key (song_id, person_id)
);
create table public.song_translator (
  song_id    uuid not null references public.song(id) on delete cascade,
  person_id  uuid not null references public.person(id),
  primary key (song_id, person_id)
);

-- ── SongVariant (per-source version) ────────────────────────────────────────
create table public.song_variant (
  id                  uuid primary key default gen_random_uuid(),
  song_id             uuid not null references public.song(id) on delete cascade,
  source_id           uuid not null references public.source(id),
  source_external_id  text,
  title               text not null,
  language            text not null,
  key                 text,
  bpm                 int,
  meter               text,
  structure           jsonb not null default '[]'::jsonb,
  lyrics_excerpt      text,
  lyrics_url          text,
  chord_chart_url     text,
  audio_demo_url      text,
  attribution_required boolean not null default true,
  attribution_text    text,
  license_info        text,
  imported_at         timestamptz not null default now(),
  last_verified_at    timestamptz,
  unique (source_id, source_external_id)
);
create index variant_song_idx     on public.song_variant (song_id);
create index variant_source_idx   on public.song_variant (source_id);
create index variant_lang_idx     on public.song_variant (language);
create index variant_title_trgm   on public.song_variant using gin (title gin_trgm_ops);

-- ── Translation (cross-language linkage) ────────────────────────────────────
create table public.translation (
  id              uuid primary key default gen_random_uuid(),
  source_song_id  uuid not null references public.song(id) on delete cascade,
  target_song_id  uuid not null references public.song(id) on delete cascade,
  relationship    text not null check (relationship in ('official','unofficial','adaptation','paraphrase')),
  attribution     text,
  verified_by     text not null check (verified_by in ('admin','community','ai_with_review')),
  verified_at     timestamptz,
  created_at      timestamptz not null default now(),
  unique (source_song_id, target_song_id)
);
create index translation_source_idx on public.translation (source_song_id);
create index translation_target_idx on public.translation (target_song_id);

-- ── Embedding (semantic search) ─────────────────────────────────────────────
create table public.embedding (
  id             uuid primary key default gen_random_uuid(),
  entity_type    text not null check (entity_type in ('song','variant')),
  entity_id      uuid not null,
  vector         vector(1024) not null,
  model_version  text not null,
  created_at     timestamptz not null default now(),
  unique (entity_type, entity_id, model_version)
);
-- HNSW index for fast similarity search
create index embedding_vector_hnsw on public.embedding
  using hnsw (vector vector_cosine_ops);

-- ── UserSong (per-church overlay) ───────────────────────────────────────────
create table public.user_song (
  church_id            uuid not null,  -- foreign key crosses Sunday products
  song_id              uuid not null references public.song(id) on delete cascade,
  preferred_key        text,
  private_notes        text,
  last_used_at         timestamptz,
  was_streamed_count   int not null default 0,
  primary key (church_id, song_id)
);
create index user_song_church_used_idx on public.user_song (church_id, last_used_at);

-- ── UsageLog (CCLI + TONO reporting source of truth) ────────────────────────
create table public.usage_log (
  id                       uuid primary key default gen_random_uuid(),
  church_id                uuid not null,
  song_id                  uuid not null references public.song(id),
  variant_id               uuid references public.song_variant(id),
  service_date             date not null,
  duration_displayed_sec   int,
  was_streamed             boolean not null default false,
  idempotency_key          text not null unique,
  recorded_at              timestamptz not null default now()
);
create index usage_church_date_idx on public.usage_log (church_id, service_date);
create index usage_song_idx        on public.usage_log (song_id);

-- ── Sync runs (operational) ────────────────────────────────────────────────
create table public.sync_run (
  id            uuid primary key default gen_random_uuid(),
  source_id     uuid not null references public.source(id),
  status        text not null check (status in ('running','succeeded','failed','partial')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  songs_added   int not null default 0,
  songs_updated int not null default 0,
  errors        jsonb not null default '[]'::jsonb
);
create index sync_run_source_idx on public.sync_run (source_id, started_at desc);

-- ── updated_at triggers ─────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger set_updated_at_song    before update on public.song    for each row execute function public.set_updated_at();
create trigger set_updated_at_person  before update on public.person  for each row execute function public.set_updated_at();
