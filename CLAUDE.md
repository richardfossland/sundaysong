# CLAUDE.md — SundaySong

SundaySong is a worship song discovery and intelligence service.

It is part of the Sunday suite (with SundayRec, SundayStage, SundayPlan). SundaySong is the **song spine** — when you add a song in Stage or Plan, SundaySong is what powers the search, autocomplete, transposition, translation, and recommendation.

## Target users

- Worship leaders looking for the right song for next Sunday
- Stage/Plan users who want "smart song features"
- Church admins doing CCLI + TONO reporting
- Public visitors to sundaysong.com discovering worship music

## Core promises

1. **The best worship song search in the world**, particularly for Nordic languages.
2. **AI features no one else has:** cross-language match, instant transposition, service-fit suggestions, license-coverage check.
3. **We don't host other people's content** — we catalog and link with proper attribution.
4. **Open to partnerships** (lovsang.no, CCLI, TONO, publishers) and **open APIs.**
5. **Free tier is genuinely useful**; Sunday Pro unlocks AI features.
6. **First worship platform to treat TONO as first-class alongside CCLI** — critical for Norwegian + Nordic churches.

## Competitive positioning

- vs **CCLI SongSelect:** we don't replace — we integrate when possible — but we add AI features they don't have, and we cover Nordic content they treat as second-class.
- vs **lovsang.no:** we are tech infrastructure they can plug into; we don't compete on content curation.
- vs **Hymnary.org:** we ingest their public-domain content + add the worship-specific intelligence.
- vs **every American competitor:** we actually handle TONO. They produce a CSV at best.

## Tech principles

- **Metadata-first, content-by-reference.** We don't store lyrics or chord charts we don't have license for. We link to authoritative sources.
- **API-first design.** Every feature is an API endpoint before it's a UI.
- **Multilingual from day one** (Norwegian, Swedish, Danish, English at launch).
- **AI features run server-side via Anthropic API.**
- **Public good as a north star** — even free users get genuinely useful discovery.

## Stack

- **Monorepo:** Turborepo + pnpm
- **API:** Hono on Bun (fast, edge-deployable)
- **Database:** Postgres via Supabase + pgvector for embeddings
- **Search:** Meilisearch (self-hosted on Fly.io, multilingual tokenization)
- **Web frontend:** Next.js 15 (sundaysong.com)
- **Background jobs:** Inngest or BullMQ + Redis
- **AI:** Anthropic API (embeddings + LLM)

## Out of scope for v1

- Hosting copyrighted lyrics / chord charts
- Multitracks/audio file hosting (we link to MultiTracks.com etc.)
- Songwriting / lyric-authoring tools (separate future product)
- Direct licensing / payment of royalties (we point to CCLI/TONO)
