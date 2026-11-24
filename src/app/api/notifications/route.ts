import { z } from "zod";
import { handler, json } from "@/lib/http/api";
import { getNotifications } from "@/lib/services/insights";
import { withActor } from "@/lib/db/context";

export const GET = handler(async (_req, { actor }) => json({ items: await getNotifications(actor) }), { require: "user" });

export const POST = handler(
  async (req, { actor }) => {
    const { ids } = z.object({ ids: z.array(z.string().uuid()).max(100) }).parse(await req.json());
    if (ids.length) await withActor(actor, (tx) => tx`update public.notifications set read_at = now() where id in ${tx(ids)} and read_at is null`);
    return json({ ok: true });
  },
  { require: "user" },
);
