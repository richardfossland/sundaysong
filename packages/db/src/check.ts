/**
 * Database smoke test.
 *
 *   DATABASE_URL=... bun run src/check.ts
 *
 * Confirms the connection works, the required extensions are installed, and
 * reports which tables + applied migrations exist. The fastest way to know
 * `db:up` + `db:migrate` actually landed.
 */

import { DEFAULT_DATABASE_URL } from "./config";

const REQUIRED_EXTENSIONS = ["vector", "pg_trgm", "pgcrypto"];

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const sql = new Bun.SQL(url);

  try {
    const exts = (await sql`
      select extname, extversion from pg_extension
      where extname in ${sql(REQUIRED_EXTENSIONS)} order by extname
    `) as Array<{ extname: string; extversion: string }>;
    const present = new Set(exts.map((e) => e.extname));

    console.log("extensions:");
    for (const name of REQUIRED_EXTENSIONS) {
      const found = exts.find((e) => e.extname === name);
      console.log(`  ${present.has(name) ? "✓" : "✗"} ${name}${found ? ` (${found.extversion})` : " — MISSING"}`);
    }

    const tables = (await sql`
      select table_name from information_schema.tables
      where table_schema = 'public' order by table_name
    `) as Array<{ table_name: string }>;
    console.log(`\ntables (${tables.length}): ${tables.map((t) => t.table_name).join(", ") || "(none)"}`);

    const migrations = tables.some((t) => t.table_name === "schema_migrations")
      ? ((await sql`select filename from public.schema_migrations order by filename`) as Array<{ filename: string }>)
      : [];
    console.log(`applied migrations (${migrations.length}): ${migrations.map((m) => m.filename).join(", ") || "(none)"}`);

    const ok = REQUIRED_EXTENSIONS.every((e) => present.has(e)) && tables.length > 0;
    console.log(`\n${ok ? "✓ database looks healthy" : "✗ database not fully set up — run pnpm db:migrate"}`);
    if (!ok) process.exit(1);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("✗ could not reach the database:", err instanceof Error ? err.message : err);
  console.error("  is it running? try: pnpm db:up");
  process.exit(1);
});
