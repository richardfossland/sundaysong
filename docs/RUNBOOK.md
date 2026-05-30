# SundaySong — local runbook

How to bring up the whole thing and exercise every feature. Requires Docker
(Colima or Desktop), `bun`, and `pnpm`.

## 1. Start the stack + data

```bash
pnpm install
pnpm db:up          # postgres (pgvector) + meilisearch + redis
pnpm db:migrate     # apply packages/db/migrations
pnpm db:seed        # 11 songs + 2 real translation pairs + demo church + usage
pnpm search:index   # build the Meilisearch index from Postgres
pnpm embed          # generate song embeddings (local, offline) for semantic search
```

> The salmebok connector also adds ~12 public-domain Norwegian hymns:
> `pnpm --filter @sundaysong/workers sync salmebok` then re-run `search:index` + `embed`.

## 2. Run the API + web

```bash
# terminal A
cd apps/api && PORT=3001 bun run dev          # http://localhost:3001

# terminal B
pnpm --filter @sundaysong/web dev             # http://localhost:3000
```

## 3. Try the features

### Web (http://localhost:3000)
- **/songs** — text search (typo-tolerant) *and* a "By meaning" toggle (semantic).
- **/songs/[id]** — full metadata, CCLI/TONO rail, lyricists, "Also known as"
  (cross-language translations), variants. SEO title + JSON-LD.
- **/sources** — data sources with indexed variant counts.
- **/about**, plus the homepage Transposer + CCLI/TONO coverage checker.

### API (http://localhost:3001)
```bash
# deep health (db + search)
curl localhost:3001/health

# text search (translations surface inline)
curl "localhost:3001/v1/songs/search?q=how%20great"

# semantic search — describe what the song is about
curl -X POST localhost:3001/v1/songs/semantic-search \
  -H 'content-type: application/json' \
  -d '{"query":"grace and salvation for sinners"}'

# recommendations — grounded in the catalog, with reasons.
# With ANTHROPIC_API_KEY set, an LLM re-orders + re-explains the picks
# ("reranked": true); without a key it's the heuristic ranker (identical shape).
curl -X POST localhost:3001/v1/recommend \
  -H 'content-type: application/json' \
  -d '{"theme":"grace","duration_min":25}'

# AI translation draft (Sunday Pro — needs ANTHROPIC_API_KEY). PD or your own
# upload only; returns a per-line singability report + confidence + disclaimer.
curl -X POST localhost:3001/v1/songs/translate \
  -H 'content-type: application/json' \
  -d '{"source_title":"Amazing Grace","source_lyrics":"Amazing grace how sweet the sound\nThat saved a wretch like me","source_language":"en","target_language":"no","copyright_status":"public_domain","style":"traditional Norwegian hymnal"}'

# instant transposition
curl -X POST localhost:3001/v1/transpose \
  -H 'content-type: application/json' \
  -d '{"chords":["G","C","D"],"from_key":"G","to_key":"A","nashville":true,"capo":true}'

# per-song CCLI/TONO coverage
curl -X POST localhost:3001/v1/licensing/coverage -H 'content-type: application/json' -d '{
  "song":{"id":"x","canonical_title":"Oceans","copyright_status":"copyrighted","ccli_song_id":"6428767"},
  "profile":{"church_id":"web-demo","ccli_streaming_addon":true,"tono_license_status":"direct_agreement","tono_streaming_addon":true,"denomination":"frikirke"}
}'

# licensing reports as downloadable CSV (demo church)
DEMO=11111111-1111-1111-1111-111111111111
curl -X POST "localhost:3001/v1/licensing/report.csv?system=ccli" -H 'content-type: application/json' \
  -d "{\"church_id\":\"$DEMO\",\"from\":\"2026-01-01\",\"to\":\"2026-12-31\"}"
curl -X POST "localhost:3001/v1/licensing/report.csv?system=tono" -H 'content-type: application/json' \
  -d "{\"church_id\":\"$DEMO\",\"from\":\"2026-01-01\",\"to\":\"2026-12-31\"}"

# data sources
curl localhost:3001/v1/sources

# contribute a song (requires the license declaration)
curl -X POST localhost:3001/v1/songs -H 'content-type: application/json' -d '{
  "title":"Min nye sang","language":"no","copyright_status":"public_domain",
  "themes":["takk"],"lyricists":["Kari Nordmann"],"license_declaration":true
}'
```

## 4. Tests

```bash
pnpm -r typecheck   # all packages + apps
pnpm -r test        # ~166 unit/integration tests (needs db:up for db/search/api)
```

## Notes
- The default embedder is **local + offline** (deterministic bag-of-words →
  `vector(1024)`), so semantic search works with no API key. Swap in a hosted
  embedder later behind `getEmbedder()` — same interface, same dims, then
  `pnpm embed --all` to re-embed.
- `bun` lives at `~/.bun/bin` if it isn't on your PATH.
- **AI features (LLM recommendation re-ranking + AI translation drafts) are
  built**, gated behind `ANTHROPIC_API_KEY` via `getLlmClient()`. No key ⇒ the
  free-tier heuristic path; translation (a Pro feature with no heuristic) returns
  422 until a key is set.
- Blocked on external credentials (not built): Hymnary/Spotify/YouTube
  connectors, real Sunday-account auth + per-user visibility/moderation.
