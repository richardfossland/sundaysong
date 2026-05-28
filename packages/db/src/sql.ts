import { DEFAULT_DATABASE_URL } from "./config";

/**
 * A Bun.SQL connection (or a transaction handle from `sql.begin`). Repositories
 * accept this so the same code runs against the shared pool, a one-off
 * connection, or a rolled-back test transaction.
 */
export type Sql = ReturnType<typeof createSql>;

export function createSql(url: string = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL) {
  return new Bun.SQL(url);
}

let shared: Sql | undefined;

/** Lazily-created shared connection for app code (workers, API). */
export function getSql(): Sql {
  if (!shared) shared = createSql();
  return shared;
}
