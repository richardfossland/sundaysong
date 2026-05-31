# Needs Richard — manual / infra-only verification

These items cannot be exercised in the sandboxed agent environment (no outbound
network, no Postgres/Meilisearch, no API keys). The pure logic behind each is
unit-tested; only the marked I/O edge needs a human with real infra.

## Hymnary connector (Phase 2.2) — NETWORK-UNVERIFIED

- File: `packages/connectors/src/sources/hymnary.ts`
- `normalizeHymnary` / `decideCopyright` / `parseHymnaryYear` are PURE and fully
  unit-tested (`packages/connectors/test/hymnary.test.ts`).
- `HymnaryConnector.discover()` and `.fetch()` perform real HTTP against
  `https://hymnary.org`. They are shaped against Hymnary's API but have NEVER
  been run here. Before trusting an import run:
  1. Confirm the real endpoint paths (`/api/scripture?page=`, `/api/text/:id`)
     and the response JSON field names (`text_id`, `authors[].died`, `date`,
     `topics`, `copyright`) against live responses; adjust the `Raw*` types if
     they differ.
  2. Check Hymnary's terms of use / rate limits and set a polite rate in the
     orchestrator's `RateLimit` for the `hymnary` source.
  3. Dry-run `discover()` for one page, eyeball the ids, then `fetch()` + a
     `normalize()` round-trip on a handful before a full sync.
  4. Verify the public-domain classifications on a sample — `decideCopyright`
     is conservative (returns `unknown` rather than guessing), so spot-check
     that real records carry enough metadata to classify the historic hymns.
- The connector is registered in `apps/workers/src/registry.ts` as `hymnary`.

## Search ranking (Phase 3.1) — pure, no infra needed

- File: `packages/search/src/ranking.ts` — fully unit-tested, runs offline.
- Intended as a deterministic tiebreaker + offline fallback for Meilisearch.
  No Richard action required; noted here only so the offline-fallback wiring
  into the API search path (when added) is reviewed against real Meili ranking.
