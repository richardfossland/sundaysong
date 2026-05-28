/**
 * Migration runner (Bun.SQL — no external driver).
 *
 *   DATABASE_URL=... bun run src/migrate.ts
 *
 * Creates a `schema_migrations` ledger, then applies each pending migration
 * file inside its own transaction and records it. Idempotent: re-running only
 * applies what's new. Requires a reachable Postgres (use `pnpm db:up` first).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { computePending } from "./planner";
import { DEFAULT_DATABASE_URL, MIGRATIONS_DIR } from "./config";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const sql = new Bun.SQL(url);

  try {
    await sql`
      create table if not exists public.schema_migrations (
        filename    text primary key,
        applied_at  timestamptz not null default now()
      )
    `;

    const appliedRows = (await sql`select filename from public.schema_migrations`) as Array<{ filename: string }>;
    const applied = appliedRows.map((r) => r.filename);
    const all = readdirSync(MIGRATIONS_DIR);
    const pending = computePending(all, applied);

    if (pending.length === 0) {
      console.log("✓ database is up to date — no pending migrations");
      return;
    }

    console.log(`▸ applying ${pending.length} migration(s)…`);
    for (const file of pending) {
      const text = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(text);
        await tx`insert into public.schema_migrations (filename) values (${file})`;
      });
      console.log(`  ✓ ${file}`);
    }
    console.log("✓ migrations complete");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("✗ migration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
