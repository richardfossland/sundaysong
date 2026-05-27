# SundaySong

Worship song discovery + AI intelligence service — part of the **Sunday suite** alongside [SundayRec](https://github.com/richardfossland/sundayrec), SundayStage, and SundayPlan.

> ⚠️ **Status:** Phase 0–1 scaffold. Postgres schema written, shared types + SDK contract published, Hono/Bun API skeleton boots with stub routes. Real ingestion + Meilisearch + embeddings + AI features all pending.

## What SundaySong is (and isn't)

SundaySong is **not** a new content library. We don't compete with CCLI or lovsang.no on song rights.

SundaySong **is** an intelligent aggregator: we index metadata from many sources (Hymnary.org, Norsk salmebok, CCLI via API, lovsang.no when partnership is signed, user uploads, Spotify/YouTube for reference recordings), and build AI features on top:

- **Semantic search** across languages and sources
- **Cross-language matching** — "Lord I lift Your name on high" ↔ "Herre, jeg løfter ditt navn"
- **Instant transposition** + translation lookup
- **AI recommendations** that understand sermon theme, worship-leader key preferences, and congregation familiarity
- **Automatic CCLI + TONO reporting** across the Sunday suite — **TONO is first-class**, not an afterthought CSV like at American competitors

For Norwegian frikirker, pinsemenigheter, and baptists who must navigate both CCLI (projection rights) AND TONO (public-performance rights), this is the differentiator.

## Stack

- **Monorepo:** Turborepo + pnpm
- **API:** Hono on Bun (fast, edge-deployable)
- **Database:** Postgres via Supabase + pgvector for embeddings
- **Search:** Meilisearch (self-hosted, multilingual tokenization for NO/SV/DA/EN)
- **Web:** Next.js 15 (sundaysong.com — Phase 6)
- **AI:** Anthropic API (embeddings + LLM)

## Repository layout

```
sundaysong/
├── apps/
│   ├── api/              Hono API service (the heart) — boots with stub routes
│   ├── web/              Next.js public site (Phase 6)
│   ├── admin/            Internal admin tools (Phase 8)
│   └── workers/          Background jobs: ingestion, embedding (Phase 2-3)
├── packages/
│   ├── sdk/              Public TypeScript SDK (@sunday/song-sdk)
│   ├── shared/           Domain types + Zod schemas
│   ├── db/               Postgres migrations
│   ├── search/           Meilisearch client + index defs (Phase 3.1)
│   └── ai/               Anthropic wrappers (Phase 4)
├── docs/
│   └── DOMAIN.md         Mermaid ERD + entity reference + queries
└── turbo.json
```

## Getting started

```bash
pnpm install
cd apps/api && bun run dev    # http://localhost:3001/health
```

Full local dev (Phase 0.3 completion needs Docker for Postgres + Meilisearch):

```bash
# When Docker is set up:
docker compose -f infra/dev/docker-compose.yml up -d
pnpm db:migrate
pnpm dev
```

## What works today

- Monorepo plumbing (Turborepo + pnpm)
- Postgres schema (`packages/db/migrations/0001_core.sql`):
  - canonical `song` + many-to-many `song_variant`
  - `person` with composer/lyricist/translator credit links
  - `translation` linking songs across languages
  - `embedding` with pgvector HNSW index for semantic search
  - `usage_log` with `was_streamed` flag → CCLI + TONO reporting
  - `nordic_metadata` JSONB for salmebok number + Norwegian PD status
- Shared TS types + Zod schemas (`@sundaysong/shared`)
- Public SDK contract (`@sunday/song-sdk`) — `SundaySong` class with `songs.search`, `songs.semanticSearch`, `songs.get`, `recommend`, `usage.log`, `licensing.report`
- Hono API skeleton with stub endpoints — boots on Bun, validates inputs with Zod, returns 501-flagged stubs noting which phase wires each

## Strategic moat

**TONO first-class.** No American worship-tech treats TONO as anything more than a CSV export. SundaySong's `usage_log.was_streamed` flag captures the critical separation between in-room and streamed performances (different royalty pools); the `tono_work_id` column on `song` is queryable from day one; `licensing.report` produces a Norwegian-labelled TONO report alongside the CCLI one.

This is the API surface SundayStage + SundayPlan call to log usage and produce reports. Owning this layer means we own the Sunday-morning-to-licensing pipeline for Norwegian + Nordic churches.

## License

TBD. SDK and shared types likely Apache-2.0; the aggregation service itself commercially licensed.
