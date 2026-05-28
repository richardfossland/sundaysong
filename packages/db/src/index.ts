/**
 * `@sundaysong/db` — Postgres migrations + tooling.
 *
 * Schema lives in `migrations/*.sql`; `migrate.ts` applies them with Bun.SQL
 * (no external driver). The repository layer (Phase 1.2) will live here too.
 */

export { sortMigrations, computePending } from "./planner";
export { DEFAULT_DATABASE_URL, MIGRATIONS_DIR } from "./config";
