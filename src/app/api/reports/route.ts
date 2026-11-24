import { after } from "next/server";
import { clientIp, handler, json, list } from "@/lib/http/api";
import { reportSubmissionSchema } from "@/lib/domain/schemas";
import { createReport, listReports, submitterFingerprint, type UploadedFile } from "@/lib/services/reports";
import { correlateReport } from "@/lib/services/correlation";
import { queueAndRun } from "@/lib/services/investigation";
import { config, isAiConfigured } from "@/lib/config";

export const maxDuration = 300;

export const GET = handler(async (req, { actor }) => {
  const u = new URL(req.url);
  const data = await listReports(actor, {
    category: list(u.searchParams.get("category")),
    severity: list(u.searchParams.get("severity")),
    verification: list(u.searchParams.get("verification")),
    investigation: list(u.searchParams.get("investigation")),
    q: u.searchParams.get("q") ?? undefined,
    clusterId: u.searchParams.get("cluster") ?? undefined,
    includeSynthetic: u.searchParams.get("synthetic") === "exclude" ? false : undefined,
    limit: Number(u.searchParams.get("limit") ?? 100),
    offset: Number(u.searchParams.get("offset") ?? 0),
  });
  return json(data);
});

function num(v: FormDataEntryValue | null): number | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

export const POST = handler(async (req, { actor }) => {
  const form = await req.formData();
  const input = reportSubmissionSchema.parse({
    title: form.get("title") ?? undefined,
    description: form.get("description") ?? undefined,
    category: form.get("category") ?? undefined,
    locationText: form.get("locationText") ?? undefined,
    latitude: num(form.get("latitude")),
    longitude: num(form.get("longitude")),
    locationSource: form.get("locationSource") ?? "none",
    locationAccuracyM: num(form.get("locationAccuracyM")),
    occurredAt: form.get("occurredAt") ?? undefined,
    anonymous: form.get("anonymous") === "true",
    contactName: form.get("contactName") ?? "",
    contactPhone: form.get("contactPhone") ?? "",
    contactEmail: form.get("contactEmail") ?? "",
  });
  const files: UploadedFile[] = [];
  for (const entry of form.getAll("files")) {
    if (typeof entry === "string") continue;
    files.push({ name: entry.name, type: entry.type, data: Buffer.from(await entry.arrayBuffer()) });
  }
  const fingerprint = submitterFingerprint(clientIp(req), req.headers.get("user-agent"));
  // On demo deployments, a submission may be explicitly labelled synthetic so
  // it joins the synthetic scenario. Synthetic and real data never correlate.
  const synthetic = config.demoMode && form.get("synthetic") === "true";
  const created = await createReport(actor, input, files, { fingerprint, synthetic });

  // Correlation is deterministic and fast; run it before responding so the
  // confirmation can show related reports. The AI investigation runs after.
  const scores = await correlateReport(created.id).catch((e) => {
    console.error("correlation failed", e);
    return [];
  });
  after(async () => {
    await queueAndRun(created.id, { trigger: "submission", triggeredBy: actor.kind === "user" ? actor.userId : null });
  });
  return json(
    {
      ...created,
      relatedReports: scores.filter((s) => s.eligible).length,
      aiConfigured: isAiConfigured(),
      synthetic,
    },
    { status: 201 },
  );
});
