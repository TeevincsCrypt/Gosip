import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

/** Drop and recreate the public schema, then apply all migrations. */
export async function resetDatabase() {
  const url = process.env.DATABASE_URL!;
  const admin = postgres(url.replace(/\/[^/]+$/, "/postgres"), { max: 1, onnotice: () => {} });
  const dbName = url.split("/").pop()!;
  const exists = await admin`select 1 from pg_database where datname = ${dbName}`;
  if (!exists.length) await admin.unsafe(`create database ${dbName}`);
  await admin.end();

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe(`drop schema if exists public cascade; drop schema if exists app cascade; create schema public;`);
  const dir = path.resolve("db/migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    await sql.unsafe(readFileSync(path.join(dir, f), "utf8"));
  }
  await sql.end();
}
