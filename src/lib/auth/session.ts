import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { config } from "@/lib/config";
import { getSql } from "@/lib/db/client";
import type { Actor } from "@/lib/db/context";
import type { SessionUser } from "@/lib/domain/types";

export const SESSION_COOKIE = "gosip_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

function secretKey(): Uint8Array {
  const secret = config.sessionSecret;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set to at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSessionToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .setIssuer("gos-ip")
    .sign(secretKey());
}

export async function setSessionCookie(userId: string) {
  const token = await createSessionToken(userId);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function userIdFromToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { issuer: "gos-ip" });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/** Resolve the current user. Role always comes from the database. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const userId = await userIdFromToken(jar.get(SESSION_COOKIE)?.value);
  if (!userId) return null;
  const rows = await getSql()<{ id: string; email: string; display_name: string; role: SessionUser["role"] }[]>`
    select id, email, display_name, role from public.profiles where id = ${userId}`;
  const row = rows[0];
  return row ? { id: row.id, email: row.email, displayName: row.display_name, role: row.role } : null;
}

export async function getActor(): Promise<{ actor: Actor; user: SessionUser | null }> {
  const user = await getSessionUser();
  return {
    user,
    actor: user ? { kind: "user", userId: user.id, role: user.role } : { kind: "anonymous" },
  };
}
