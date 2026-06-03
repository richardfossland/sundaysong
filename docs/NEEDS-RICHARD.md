# Needs Richard — manual / infra-only verification

These items cannot be exercised in the sandboxed agent environment (no outbound
network, no Postgres/Meilisearch, no API keys). The pure logic behind each is
unit-tested; only the marked I/O edge needs a human with real infra.

## Hymnary connector (Phase 2.2) — NETWORK-UNVERIFIED

- File: `packages/connectors/src/sources/hymnary.ts`
- `normalizeHymnary` / `decideCopyright` / `parseHymnaryYear` are PURE and fully
  unit-tested. The live-JSON mappers `parseScriptureItem` /
  `parseScriptureResponse` / `parseTextIdFromLink` are also PURE and unit-tested
  (`packages/connectors/test/hymnary.test.ts`).

### API contract — verified against the docs (2026-06), not yet against live JSON

The connector was originally shaped against an *invented* contract
(`/api/scripture?page=` returning `{texts,has_more}` plus a per-id
`/api/text/:id`). That was reconciled against Hymnary's published API docs and
rewritten:
  - Hymnary's only public JSON endpoint is the **scripture** search:
    `GET /api/scripture?reference=Psalm+136` (or `?book=&fromChapter=&...`).
  - It returns up to 100 hymns for that passage. Each item uses **human-readable,
    space-separated keys**: `title`, `date`, `meter`, `originalLanguage`,
    `"text link"`, `"number of hymnals"`, `"scripture references"`, plus person
    role keys (`author`/`translator`/`composer`/`arranger`). There is **no**
    `text_id` field and **no** per-id JSON endpoint — the text-authority id is
    parsed out of the `"text link"` URL, and the metadata we need is inline.
  - `discover()` therefore walks a list of scripture references
    (`DEFAULT_DISCOVERY_REFERENCES`, one passage per page), caching each parsed
    record; `fetch()` serves from that cache, so a sync hits the network ~once
    per reference rather than once per hymn.

Still UNVERIFIED against a live response (do before a full sync):
  1. Confirm the live body's *top-level shape* — `parseScriptureResponse` accepts
     both a JSON array and an index-keyed object; confirm which Hymnary returns
     and that person values arrive as strings/arrays as parsed.
  2. Confirm whether live items carry `born`/`died` for authors. The docs list
     roles but not life years; if they are absent inline, life+70 classification
     will fall back to the pre-1929 publication cutoff (which still covers most
     historic hymnody) and otherwise return `unknown` for review — by design.
  3. Per-source rate limiting is now wired: `apps/workers/src/registry.ts`
     `RATE_LIMITS.hymnary = { ratePerSec: 1, capacity: 3 }`, applied via
     `getRunOptions()`. Re-check Hymnary's terms of use and adjust if needed.
  4. Dry-run `discover()` for one reference, eyeball the ids, then `fetch()` + a
     `normalize()` round-trip on a handful before a full sync.
  5. Verify the public-domain classifications on a sample — `decideCopyright`
     is conservative (returns `unknown` rather than guessing), so spot-check
     that real records carry enough metadata to classify the historic hymns.
- The connector is registered in `apps/workers/src/registry.ts` as `hymnary`.

## Search ranking (Phase 3.1) — pure, no infra needed

- File: `packages/search/src/ranking.ts` — fully unit-tested, runs offline.
- Intended as a deterministic tiebreaker + offline fallback for Meilisearch.
  No Richard action required; noted here only so the offline-fallback wiring
  into the API search path (when added) is reviewed against real Meili ranking.
