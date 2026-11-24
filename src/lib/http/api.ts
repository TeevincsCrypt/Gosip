import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getActor } from "@/lib/auth/session";
import { isStaff, type Actor } from "@/lib/db/context";
import type { SessionUser } from "@/lib/domain/types";
import { SubmissionError } from "@/lib/services/reports";
import { ReviewError } from "@/lib/services/review";

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, { ...init, headers: { "cache-control": "no-store", ...(init?.headers ?? {}) } });
}

type Ctx = { actor: Actor; user: SessionUser | null };

/** Wrap a route handler with actor resolution and consistent error mapping. */
export function handler<P = unknown>(
  fn: (req: Request, ctx: Ctx, params: P) => Promise<Response>,
  opts: { require?: "user" | "staff" | "admin" } = {},
) {
  return async (req: Request, route: { params: Promise<P> }) => {
    try {
      const ctx = await getActor();
      if (opts.require === "user" && !ctx.user) throw new HttpError(401, "Sign in required");
      if (opts.require === "staff" && !isStaff(ctx.actor)) {
        throw new HttpError(ctx.user ? 403 : 401, ctx.user ? "Analyst or administrator role required" : "Sign in required");
      }
      if (opts.require === "admin" && ctx.user?.role !== "admin") throw new HttpError(ctx.user ? 403 : 401, "Administrator role required");
      return await fn(req, ctx, (await route?.params) as P);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) return json({ error: err.message }, { status: err.status });
  if (err instanceof SubmissionError) return json({ error: err.message, field: err.field }, { status: err.status });
  if (err instanceof ReviewError) return json({ error: err.message }, { status: err.status });
  if (err instanceof ZodError) {
    return json(
      { error: "Validation failed", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
      { status: 400 },
    );
  }
  const message = (err as Error)?.message ?? "Unexpected error";
  if (/DATABASE_URL is not configured/.test(message)) return json({ error: message, code: "database_not_configured" }, { status: 503 });
  if (/permission denied|row-level security/i.test(message)) return json({ error: "Not permitted" }, { status: 403 });
  console.error(err);
  return json({ error: "Internal server error" }, { status: 500 });
}

export function list(param: string | null): string[] | undefined {
  if (!param) return undefined;
  const items = param.split(",").map((s) => s.trim()).filter(Boolean);
  return items.length ? items : undefined;
}

export function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function assertUuid(id: string) {
  if (!UUID.test(id)) throw new HttpError(404, "Not found");
}
