import { handler, json } from "@/lib/http/api";
import { getClusters } from "@/lib/services/insights";

export const GET = handler(async (_req, { actor }) => json({ items: await getClusters(actor) }));
