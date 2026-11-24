import { handler, json } from "@/lib/http/api";
import { getEvidenceList } from "@/lib/services/insights";

export const GET = handler(async (_req, { actor }) => json({ items: await getEvidenceList(actor) }), { require: "staff" });
