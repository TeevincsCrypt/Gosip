import { handler, json, HttpError } from "@/lib/http/api";
import { loginSchema } from "@/lib/domain/schemas";
import { getSql } from "@/lib/db/client";
import { setSessionCookie, verifyPassword } from "@/lib/auth/session";

export const POST = handler(async (req) => {
  const { email, password } = loginSchema.parse(await req.json());
  const [row] = await getSql()<{ id: string; password_hash: string; role: string; display_name: string }[]>`
    select p.id, c.password_hash, p.role, p.display_name from public.profiles p
    join public.credentials c on c.profile_id = p.id where p.email = ${email}`;
  // Constant-ish time: always run a bcrypt comparison.
  const ok = await verifyPassword(password, row?.password_hash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali");
  if (!row || !ok) throw new HttpError(401, "Invalid email or password");
  await getSql()`update public.profiles set last_login_at = now() where id = ${row.id}`;
  await setSessionCookie(row.id);
  return json({ id: row.id, role: row.role, displayName: row.display_name });
});
