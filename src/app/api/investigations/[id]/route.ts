import { assertUuid, handler, HttpError, json } from "@/lib/http/api";
import { isStaff, withActor } from "@/lib/db/context";

export const GET = handler<{ id: string }>(async (_req, { actor }, { id }) => {
  assertUuid(id);
  const staff = isStaff(actor);
  const data = await withActor(actor, async (tx) => {
    const [inv] = staff
      ? await tx`select * from public.investigations where id = ${id}`
      : await tx`select * from public.investigations_public where id = ${id}`;
    if (!inv) return null;
    const findings = staff
      ? await tx`select * from public.agent_findings where investigation_id = ${id} order by started_at nulls last`
      : await tx`select * from public.agent_findings_public where investigation_id = ${id} order by started_at nulls last`;
    const [report] = await tx`select id, reference, title, category, severity, confidence, verification_status, investigation_status, is_synthetic, is_sensitive, location_text, occurred_at
                              from public.reports_public where id = ${inv.report_id}`;
    const events = await tx`select id, event_type, summary, actor_type, created_at from public.incident_events where investigation_id = ${id} order by id`;
    return { investigation: inv, findings, report: report ?? null, events, viewer: { staff } };
  });
  if (!data) throw new HttpError(404, "Investigation not found");
  return json(data);
});
