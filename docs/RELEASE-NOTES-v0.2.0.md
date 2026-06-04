# SundaySong v0.2.0-beta

Second testable beta. Same one-command stack as v0.1.0 — this release deepens
the intelligence layer (recommendations, AI features, moderation) and hardens
the offline-degradation path. **Still a beta for testing**, not production.

## Run it

Identical to v0.1.0 (Docker + `docker compose up --build`). See
`docs/RELEASE-NOTES-v0.1.0.md` and `docs/RUNBOOK.md`.

## What's new since v0.1.0-beta

- **Recommendation use cases B/C/D.** Beyond the original catalog-grounded
  picks (use case A), the engine now offers circle-of-fifths key-flow
  sequencing (B), liturgical-season suggestions (C), and energy-arc set
  ordering with a per-song energy estimator (D).
- **AI tier behind an Anthropic key.** LLM re-ranking of recommendations and
  AI translation drafts, both grounded (the LLM may only reorder/explain song
  IDs we supply; hallucinated IDs are dropped) and gated behind
  `getLlmClient()` so the free tier still works without a key.
- **Offline search degradation.** When Meilisearch is unavailable the API now
  falls back to the dependency-free, **Nordic-aware** text ranker
  (`@sundaysong/shared` `foldNordic`/`tokenize`), so search degrades gracefully
  instead of failing.
- **User contributions + moderation (Phase 8).** Song-upload UI on the web app,
  upload/moderation state in the schema, `/v1/admin` moderation + analytics
  routes, and an admin moderation dashboard.
- **Opt-in Sunday JWT auth** for per-user features, plus a canonical
  `UsageEvent` contract for `/v1/usage/log`.
- **Hymnary connector** reconciled against the real `/api/scripture` contract.

## Quality

~590 tests across the workspace; CI runs typecheck + db:migrate + tests + web
build on every push. The pure-logic suites run fully offline; the `db` and
`search` integration suites require the Docker services (`pnpm db:up`).

## Not in this beta (needs credentials / accounts)

Spotify/YouTube connectors and a hosted embedder (semantic search still uses
the local offline embedder behind `getEmbedder()`). AI features require an
Anthropic API key.
