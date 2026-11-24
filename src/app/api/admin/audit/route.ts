import { handler, json } from "@/lib/http/api";
import { getAuditLog } from "@/lib/services/insights";

export const GET = handler(async (_req, { actor }) => json({ items: await getAuditLog(actor) }), { require: "staff" });
