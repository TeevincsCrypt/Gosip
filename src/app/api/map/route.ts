import { handler, json } from "@/lib/http/api";
import { getMapData } from "@/lib/services/insights";

export const GET = handler(async (_req, { actor }) => json(await getMapData(actor)));
