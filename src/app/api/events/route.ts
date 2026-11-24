import { handler, json } from "@/lib/http/api";
import { getEvents } from "@/lib/services/insights";

export const GET = handler(async (req, { actor }) => {
  const u = new URL(req.url);
  const items = await getEvents(actor, {
    afterId: Number(u.searchParams.get("after") ?? 0) || 0,
    limit: Number(u.searchParams.get("limit") ?? 40),
    reportId: u.searchParams.get("report") ?? undefined,
  });
  return json({ items });
});
