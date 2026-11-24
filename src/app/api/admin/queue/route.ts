import { handler, json } from "@/lib/http/api";
import { getReviewQueue } from "@/lib/services/insights";

export const GET = handler(async (_req, { actor }) => json({ items: await getReviewQueue(actor) }), { require: "staff" });
