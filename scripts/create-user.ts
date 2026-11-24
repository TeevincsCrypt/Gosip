/**
 * Create or update a user with a given role (reporter | analyst | admin).
 *   npm run db:create-user -- --email you@org.org --name "Your Name" --role admin
 * The password is read from the GOSIP_USER_PASSWORD environment variable, or
 * generated and printed once if not supplied.
 */
import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { randomBytes, randomUUID } from "node:crypto";
loadEnv({ path: ".env.local", override: false });

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const { getSql, closeSql } = await import("@/lib/db/client");
  const { hashPassword } = await import("@/lib/auth/session");
  const email = arg("email")?.toLowerCase();
  const name = arg("name") ?? email;
  const role = (arg("role") ?? "analyst") as "reporter" | "analyst" | "admin";
  const demo = process.argv.includes("--demo");
  if (!email || !["reporter", "analyst", "admin"].includes(role)) {
    throw new Error("usage: --email <email> [--name <name>] [--role reporter|analyst|admin] [--demo]");
  }
  const password = process.env.GOSIP_USER_PASSWORD ?? randomBytes(12).toString("base64url");
  const sql = getSql();
  try {
    const hash = await hashPassword(password);
    const [existing] = await sql`select id from public.profiles where email = ${email}`;
    const id = existing?.id ?? randomUUID();
    await sql.begin(async (tx) => {
      if (existing) await tx`update public.profiles set role = ${role}, display_name = ${name!}, is_demo_account = ${demo} where id = ${id}`;
      else await tx`insert into public.profiles (id, email, display_name, role, is_demo_account) values (${id}, ${email}, ${name!}, ${role}, ${demo})`;
      await tx`insert into public.credentials (profile_id, password_hash) values (${id}, ${hash})
               on conflict (profile_id) do update set password_hash = excluded.password_hash, updated_at = now()`;
      await tx`insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, new_state, explanation)
               values (null, 'system', ${existing ? "update_user" : "create_user"}, 'profile', ${id}, ${tx.json({ email, role })}, 'Created via create-user script')`;
    });
    console.log(`${existing ? "updated" : "created"} ${role} ${email}`);
    if (!process.env.GOSIP_USER_PASSWORD) console.log(`generated password: ${password}`);
  } finally {
    await closeSql();
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
