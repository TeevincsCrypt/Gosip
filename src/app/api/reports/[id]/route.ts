import { assertUuid, handler, HttpError, json } from "@/lib/http/api";
import { getReportDetail } from "@/lib/services/reports";

export const GET = handler<{ id: string }>(async (_req, { actor }, { id }) => {
  assertUuid(id);
  const detail = await getReportDetail(actor, id);
  if (!detail) throw new HttpError(404, "Report not found");
  return json(detail);
});
