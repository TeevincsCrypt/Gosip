import "server-only";
import type postgres from "postgres";
import { getSql, type DbTypes } from "./client";

export type AppRole = "reporter" | "analyst" | "admin";

export type Actor =
  | { kind: "anonymous" }
  | { kind: "user"; userId: string; role: AppRole };

export type Tx = postgres.TransactionSql<DbTypes>;

export function isStaff(actor: Actor): boolean {
  return actor.kind === "user" && (actor.role === "analyst" || actor.role === "admin");
}

/**
 * Runs `fn` in a transaction that has switched to a restricted database role.
 * PostgreSQL row level security is enforced for every statement inside.
 *
 * `asReviewer` marks the transaction as a human review action, which is the
 * only context in which the database allows verify/resolve transitions.
 */
export async function withActor<T>(
  actor: Actor,
  fn: (tx: Tx) => Promise<T>,
  opts: { asReviewer?: boolean } = {},
): Promise<T> {
  const sql = getSql();
  const result = await sql.begin(async (tx) => {
    const userId = actor.kind === "user" ? actor.userId : "";
    const actorType = opts.asReviewer && isStaff(actor) ? "reviewer" : "user";
    await tx`select set_config('app.user_id', ${userId}, true), set_config('app.actor_type', ${actorType}, true)`;
    await tx.unsafe(actor.kind === "user" ? "set local role gosip_user" : "set local role gosip_anon");
    return fn(tx as unknown as Tx);
  });
  return result as T;
}

/**
 * Trusted system transaction (bypasses RLS). `actorType` is recorded so the
 * database can refuse human-only transitions from AI/system code.
 */
export async function withSystem<T>(
  actorType: "system" | "agent",
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const sql = getSql();
  const result = await sql.begin(async (tx) => {
    await tx`select set_config('app.actor_type', ${actorType}, true)`;
    return fn(tx as unknown as Tx);
  });
  return result as T;
}
