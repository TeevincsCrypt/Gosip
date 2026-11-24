import { assertUuid, handler, HttpError } from "@/lib/http/api";
import { getReportDetail } from "@/lib/services/reports";
import { buildIntelligenceReportPdf } from "@/lib/pdf/intelligence-report";

export const GET = handler<{ id: string }>(async (_req, { actor }, { id }) => {
  assertUuid(id);
  const detail = await getReportDetail(actor, id);
  if (!detail) throw new HttpError(404, "Report not found");
  const pdf = await buildIntelligenceReportPdf(detail);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="GOS-IP-${detail.report.reference}.pdf"`,
      "cache-control": "no-store",
    },
  });
});
