import { handler, json } from "@/lib/http/api";
import { getDashboardStats } from "@/lib/services/insights";

export const GET = handler(async (req, { actor }) => {
  const u = new URL(req.url);
  return json(await getDashboardStats(actor, { includeSynthetic: u.searchParams.get("synthetic") !== "exclude" }));
});
