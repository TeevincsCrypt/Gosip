import { handler, json } from "@/lib/http/api";
import { getGraph } from "@/lib/services/insights";

export const GET = handler(async (req, { actor }) => {
  const cluster = new URL(req.url).searchParams.get("cluster") ?? undefined;
  return json(await getGraph(actor, { clusterId: cluster }));
});
