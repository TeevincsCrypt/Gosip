import { handler, json } from "@/lib/http/api";
import { getAnalytics } from "@/lib/services/insights";

export const GET = handler(async (_req, { actor }) => json(await getAnalytics(actor)));
