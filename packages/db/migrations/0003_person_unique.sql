-- SundaySong migration 0003 — dedup persons by name.
-- v1 simplification: people are deduped on display_name so connectors can
-- find-or-create a lyricist by name. Homonyms merge for now; this gets
-- revisited when an external authority file (external_ids) lands.

create unique index if not exists person_display_name_uidx on public.person (display_name);
