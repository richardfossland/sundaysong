# Deploy — SundaySong → song.sundaysuite.app + api.sundaysuite.app

## Why NOT a Cloudflare Worker (unlike Plan/Chess/Turnering)

Those apps are single Next.js front-ends backed by Supabase over HTTP, which
runs fine on Workers via OpenNext. **SundaySong is different by design:**

- `apps/web` sets `output: "standalone"` and ships an `apps/web/Dockerfile` — it
  is built for a **Node container**, and it is a thin client that calls the API
  (no direct Supabase deps).
- `apps/api` is a **Hono/Bun** service (`Dockerfile.api`) that talks to
  **Postgres + pgvector** via `@sundaysong/db`. Cloudflare Workers cannot open a
  raw TCP Postgres connection (no Hyperdrive in the free path), and the pgvector
  HNSW search is SQL, not PostgREST.

Forcing this onto Workers would mean re-architecting the data layer (Hyperdrive
or a full supabase-js/RPC rewrite). For a test phase that is the wrong trade —
**deploy it the way it was built: as containers.** The Dockerfiles already exist.

## Recommended subdomains (flat → free `*.sundaysuite.app` SSL)

| Surface | Subdomain | Image |
|---|---|---|
| Public web (search/discovery) | `song.sundaysuite.app` | `apps/web/Dockerfile` |
| API | `api.sundaysuite.app` | `Dockerfile.api` |
| Admin (`apps/admin`) | `song.sundaysuite.app/admin` later, or `admin.sundaysuite.app` | (defer for test phase) |

`api.sundaysuite.app` is named as a shared suite gateway, not `api.song.…`,
because nested `*.*.sundaysuite.app` is **not** covered by Cloudflare's free
universal cert.

## Test-phase path (containers behind Cloudflare)

1. **Pick a container host** that supports Postgres-backed services: Fly.io,
   Render, or Railway are all fine (Fly is closest to "edge"). _Decision needed —
   I can add a `fly.toml` / `render.yaml` once you choose._
2. **Build + push** the two images (web + api). The repo's `docker-compose.yml`
   already wires them together for local dev — mirror those env vars in prod.
3. **Env / secrets** (per the compose file): `DATABASE_URL` (Supabase Postgres
   pooler URL), `ANTHROPIC_API_KEY` (Phase-4 AI/embeddings), the Sunday SSO
   verification env (live issuer = the shared Sunday project, also SundayPlan's
   backend; auth stays a no-op pass-through until these are set):

   ```
   SUNDAY_JWKS_URL=https://rkiahljrkormwzogghpc.supabase.co/auth/v1/.well-known/jwks.json
   SUNDAY_AUTH_AUDIENCE=authenticated
   SUNDAY_AUTH_ISSUER=https://rkiahljrkormwzogghpc.supabase.co/auth/v1
   ```

   and the web's `NEXT_PUBLIC_API_URL=https://api.sundaysuite.app`.
4. **DNS in Cloudflare:** add `song` and `api` records pointing at the host
   (CNAME to the host's hostname, **proxied / orange-cloud**) → free SSL + you
   can put **Cloudflare Access** in front for the test phase.

## ⚠️ Security gate before exposing (suite audit 06-10)

- **Admin API has no role check** (`apps/api/src/routes/admin.ts:289` — any valid
  Sunday JWT can moderate/approve all user songs + read global analytics). Add an
  admin-claim/`app_grants` check **before** `api.` is reachable by anyone but you.
- **`usage_log.idempotency_key` is globally unique, not church-scoped**
  (`packages/db/migrations/0001_core.sql:162`) — cross-church collisions silently
  drop TONO/CCLI events. Fix to `unique (church_id, idempotency_key)`.

Until both land, keep `song.`/`api.` behind Cloudflare Access (invited testers
only).

## Marketing site

Once live, flip the SundaySong card on `sundaysuite.app` from "In development" to
`https://song.sundaysuite.app` (edit `sundaysuite-website/build.py`).
