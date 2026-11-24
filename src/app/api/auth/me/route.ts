import { handler, json } from "@/lib/http/api";

export const GET = handler(async (_req, { user }) => json({ user }));
