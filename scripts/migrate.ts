/**
 * Applies SQL migrations in db/migrations in lexical order.
 * Usage: DATABASE_URL=... npm run db:migrate
 */
import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const sql = postgres(url, {
    prepare: false,
    max: 1,
    onnotice: () => {},
    ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : "require",
  });
  try {
    await sql`create table if not exists public.schema_migrations (
      name text primary key, applied_at timestamptz not null default now())`;
    const dir = path.resolve("db/migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const applied = new Set(
      (await sql<{ name: string }[]>`select name from public.schema_migrations`).map((r) => r.name),
    );
    for (const file of files) {
      if (applied.has(file)) continue;
      const body = readFileSync(path.join(dir, file), "utf8");
      process.stdout.write(`applying ${file} ... `);
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx.unsafe("insert into public.schema_migrations (name) values ($1)", [file]);
      });
      console.log("ok");
    }
    console.log("migrations up to date");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
