import { randomUUID } from "node:crypto";
import { handler, json, HttpError } from "@/lib/http/api";
import { registerSchema } from "@/lib/domain/schemas";
import { getSql } from "@/lib/db/client";
import { hashPassword, setSessionCookie } from "@/lib/auth/session";

/** Self-registration always creates a "reporter". Elevated roles are granted by administrators only. */
export const POST = handler(async (req) => {
  const input = registerSchema.parse(await req.json());
  const sql = getSql();
  const [exists] = await sql`select 1 from public.profiles where email = ${input.email}`;
  if (exists) throw new HttpError(409, "An account with this email already exists");
  const id = randomUUID();
  const hash = await hashPassword(input.password);
  await sql.begin(async (tx) => {
    await tx`insert into public.profiles (id, email, display_name, role, organization)
             values (${id}, ${input.email}, ${input.displayName}, 'reporter', ${input.organization || null})`;
    await tx`insert into public.credentials (profile_id, password_hash) values (${id}, ${hash})`;
  });
  await setSessionCookie(id);
  return json({ id, role: "reporter" }, { status: 201 });
});
