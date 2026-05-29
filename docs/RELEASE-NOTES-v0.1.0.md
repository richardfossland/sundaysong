# SundaySong v0.1.0-beta

First testable release — the full worship-song intelligence stack runs from one
command. **This is a beta for testing**, not a production deployment.

## Run it

Requires Docker.

```bash
git clone https://github.com/richardfossland/sundaysong
cd sundaysong
git checkout v0.1.0-beta
docker compose up --build
```

Then open:
- **Web** — http://localhost:3000
- **API** — http://localhost:3001 (try http://localhost:3001/health)

The stack starts Postgres (pgvector) + Meilisearch + Redis, runs a one-shot
init job (migrate → seed → import the Norwegian salmebok → build the search
index → generate embeddings), then the API and web. First boot builds images
and may take a few minutes.

## What you can test

- **Search** (`/songs`) — typo-tolerant text search *and* a "By meaning"
  (semantic) mode. Try "the song about chains falling off".
- **Song detail** (`/songs/[id]`) — metadata, CCLI/TONO rail, lyricists,
  cross-language "Also known as", variants, SEO structured data.
- **Sources** (`/sources`) and **About** (`/about`).
- **Transposition** + **CCLI/TONO coverage** on the homepage.
- **API**: `/v1/songs/search`, `/v1/songs/semantic-search`, `/v1/recommend`,
  `/v1/transpose`, `/v1/licensing/coverage`, `/v1/licensing/report.csv`,
  `/v1/sources`, `POST /v1/songs` (upload). See `docs/RUNBOOK.md` for curl
  examples.

## What's in this release

Catalog + search spine: domain model, source-connector framework + Norwegian
salmebok import, full-text (Meilisearch) and **semantic** search (offline local
embedder + pgvector), cross-language translations, transposition, the
CCLI/TONO-first licensing engine with CSV export, a catalog-grounded
recommendation engine, the public REST API (rate-limited, deep health checks),
the TypeScript SDK, and the public web app. ~166 tests; CI runs typecheck +
tests + web build on every push.

## Not in this beta (needs credentials / accounts)

Hymnary/Spotify/YouTube connectors, AI translation drafts + LLM recommendation
re-ranking (Anthropic key), and Sunday-account auth with per-user upload
visibility + moderation. Semantic search uses a local offline embedder; a hosted
embedder slots in behind `getEmbedder()` later.
