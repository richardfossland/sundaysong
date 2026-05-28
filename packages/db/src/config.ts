import { join } from "node:path";

/** Matches infra/dev/docker-compose.yml so the tooling works with zero config. */
export const DEFAULT_DATABASE_URL = "postgres://sunday:sunday@localhost:5432/sundaysong";

export const MIGRATIONS_DIR = join(import.meta.dirname, "..", "migrations");
