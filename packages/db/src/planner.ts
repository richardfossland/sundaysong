/**
 * Migration planning — pure, no I/O.
 *
 * Migrations are plain `.sql` files named with a zero-padded ordinal
 * (`0001_core.sql`, `0002_...`). We sort them numerically and diff against the
 * filenames already recorded in `schema_migrations` to find what to run.
 */

/** Keep only `.sql` files, ordered by their numeric prefix. */
export function sortMigrations(files: string[]): string[] {
  return files
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

/** Migrations present on disk that haven't been applied yet, in run order. */
export function computePending(all: string[], applied: string[]): string[] {
  const done = new Set(applied);
  return sortMigrations(all).filter((f) => !done.has(f));
}
