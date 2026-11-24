import { after } from "next/server";
import { z } from "zod";
import { handler, json, HttpError } from "@/lib/http/api";
import { getInvestigations } from "@/lib/services/insights";
import { queueAndRun } from "@/lib/services/investigation";
import { isAiConfigured } from "@/lib/config";
import { getSql } from "@/lib/db/client";

export const maxDuration = 300;

export const GET = handler(async (_req, { actor }) => json({ items: await getInvestigations(actor), aiConfigured: isAiConfigured() }));

/** Staff-only: (re)run an investigation, e.g. after a partial failure. */
export const POST = handler(
  async (req, { actor, user }) => {
    const { reportId } = z.object({ reportId: z.string().uuid() }).parse(await req.json());
    const [running] = await getSql()`select 1 from public.investigations where report_id = ${reportId} and status = 'running' and started_at > now() - interval '10 minutes'`;
    if (running) throw new HttpError(409, "An investigation is already running for this report");
    const [exists] = await getSql()`select investigation_status from public.reports where id = ${reportId}`;
    if (!exists) throw new HttpError(404, "Report not found");
    await getSql()`update public.reports set investigation_status = ${isAiConfigured() ? "queued" : "not_configured"} where id = ${reportId}`;
    after(async () => {
      await queueAndRun(reportId, { trigger: "retry", triggeredBy: user!.id });
    });
    void actor;
    return json({ queued: true, aiConfigured: isAiConfigured() }, { status: 202 });
  },
  { require: "staff" },
);
