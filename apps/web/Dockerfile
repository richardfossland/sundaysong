# SundaySong web (Next.js 15, standalone output). Build context is the repo root:
#   docker build -f apps/web/Dockerfile .

FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json       apps/api/package.json
COPY apps/web/package.json       apps/web/package.json
COPY apps/workers/package.json   apps/workers/package.json
COPY packages/ai/package.json          packages/ai/package.json
COPY packages/connectors/package.json  packages/connectors/package.json
COPY packages/db/package.json          packages/db/package.json
COPY packages/licensing/package.json   packages/licensing/package.json
COPY packages/matching/package.json    packages/matching/package.json
COPY packages/music/package.json       packages/music/package.json
COPY packages/search/package.json      packages/search/package.json
COPY packages/sdk/package.json         packages/sdk/package.json
COPY packages/shared/package.json      packages/shared/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @sundaysong/web build

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Next standalone bundles a minimal server + node_modules. With the tracing root
# pinned to the repo, the entrypoint lives at apps/web/server.js.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
