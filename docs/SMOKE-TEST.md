# Smoke test — manual verification matrix

Pure logic is covered by `pnpm test`. This table tracks the I/O edges that need
real infra / network and are wired-but-unverified in the agent environment.

| Area | What to verify | How | Status |
|------|----------------|-----|--------|
| Hymnary `discover()` | Paging over `/api/scripture` returns text ids | `getConnector("hymnary").discover()` against live API | NETWORK-UNVERIFIED |
| Hymnary `fetch()` | One `/api/text/:id` record parses into `RawHymnaryText` | `getConnector("hymnary").fetch("amazing_grace_how_sweet_the_sound")` | NETWORK-UNVERIFIED |
| Hymnary PD classification | Sampled real records classify sanely (PD / copyrighted / unknown) | normalize a sample after a live fetch, eyeball `attribution_text` reasons | NETWORK-UNVERIFIED |
| Search ranking fallback | `rankDocs` ordering is acceptable next to live Meili ranking | compare `rankDocs(q, docs)` to Meili `search(q)` on the same corpus | NEEDS-MEILI |

See `docs/NEEDS-RICHARD.md` for the detailed checklist behind the Hymnary rows.
