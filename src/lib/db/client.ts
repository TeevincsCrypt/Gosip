import "server-only";
import postgres from "postgres";
import { requireDatabaseUrl } from "@/lib/config";

type DbTypes = { numeric: number };
type Sql = postgres.Sql<DbTypes>;

const globalForDb = globalThis as unknown as { __gosipSql?: Sql };

/**
 * Owner connection. Bypasses RLS — use only from trusted system code paths,
 * and use `withActor` (./context) for anything initiated by a user.
 */
export function getSql(): Sql {
  if (!globalForDb.__gosipSql) {
    const url = requireDatabaseUrl();
    globalForDb.__gosipSql = postgres(url, {
      // Compatible with Supabase's transaction pooler (pgbouncer).
      prepare: false,
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      idle_timeout: 20,
      connect_timeout: 15,
      ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : "require",
      onnotice: () => {},
      types: {
        // numeric -> JS number (confidence, scores, distances)
        numeric: {
          to: 1700,
          from: [1700],
          serialize: (x: number) => String(x),
          parse: (x: string) => Number(x),
        },
      },
    });
  }
  return globalForDb.__gosipSql!;
}

export async function closeSql(): Promise<void> {
  if (globalForDb.__gosipSql) {
    await globalForDb.__gosipSql.end({ timeout: 5 });
    globalForDb.__gosipSql = undefined;
  }
}

export type { Sql, DbTypes };
