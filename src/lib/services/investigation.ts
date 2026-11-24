import "server-only";
import { config } from "@/lib/config";
import { withSystem } from "@/lib/db/context";
import { getSql } from "@/lib/db/client";
import sharp from "sharp";
import { createDefaultProvider } from "@/lib/ai/groq";
import type { AIProvider, ContentPart } from "@/lib/ai/provider";
import { runAgent, type AgentRunResult } from "@/lib/agents/runner";
import { PROMPTS } from "@/lib/agents/prompts";
import {
  classificationSchema,
  corroborationSchema,
  evidenceSchema,
  geospatialSchema,
  leadSchema,
  threatSchema,
  type ClassificationOutput,
  type CorroborationOutput,
  type EvidenceOutput,
  type GeospatialOutput,
  type LeadOutput,
  type ThreatOutput,
} from "@/lib/agents/schemas";
import { AGENTS, categoryLabel, type AgentId, type Severity } from "@/lib/domain/constants";
import { haversineKm } from "@/lib/correlation/engine";
import { storageFor } from "@/lib/storage";
import { correlateReport, correlationParams } from "./correlation";
import { notifyStaff, recordEvent } from "./events";

interface InvestigationReport {
  id: string;
  reference: string;
  title: string;
  description: string;
  category: string;
  location_text: string;
  latitude: number | null;
  longitude: number | null;
  location_source: string;
  location_accuracy_m: number | null;
  occurred_at: Date;
  submitted_at: Date;
  is_anonymous: boolean;
  has_contact: boolean;
  is_registered: boolean;
  is_sensitive: boolean;
  is_synthetic: boolean;
}

interface EvidenceRecord {
  id: string;
  mime_type: string;
  file_kind: string;
  storage_backend: "supabase" | "local";
  storage_path: string;
  metadata: Record<string, unknown>;
  metadata_flags: string[];
  duplicate_of: string | null;
  duplicate_kind: string | null;
  exif_latitude: number | null;
  exif_longitude: number | null;
}

export interface InvestigationOutcome {
  investigationId: string;
  status: "completed" | "partial" | "failed" | "not_configured";
  agentStatuses: Record<AgentId, string>;
}

const AGENT_NAME = Object.fromEntries(AGENTS.map((a) => [a.id, a.name])) as Record<AgentId, string>;

function reportBlock(r: InvestigationReport): string {
  return `<report reference="${r.reference}">
title: ${r.title}
submitted_category: ${r.category} (${categoryLabel(r.category)})
stated_location: ${r.location_text}
coordinates: ${r.latitude !== null ? `${r.latitude.toFixed(5)}, ${r.longitude!.toFixed(5)} (source: ${r.location_source}${r.location_accuracy_m ? `, accuracy ~${Math.round(r.location_accuracy_m)} m` : ""})` : "not provided"}
incident_time_reported: ${r.occurred_at.toISOString()}
submitted_at: ${r.submitted_at.toISOString()}
submitter: ${r.is_anonymous ? "anonymous (no follow-up channel)" : r.is_registered ? "registered account" : r.has_contact ? "unregistered, contact details provided" : "unregistered, no contact details"}
description:
${r.description}
</report>`;
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 1);
}

/**
 * Run the full multi-agent investigation for one report.
 *
 * Stage 1  Classification (A)
 * Stage 2  Evidence (B) | Geospatial (C) | Corroboration (D)   — in parallel
 * Stage 3  Threat assessment (E)
 * Stage 4  Lead investigator synthesis (F)
 *
 * Every agent's output, failure, attempts and timings are persisted. A failed
 * agent never aborts the others; the investigation is then marked "partial"
 * (or "failed" if no synthesis was possible) — never "completed".
 */
export async function runInvestigation(
  reportId: string,
  opts: { trigger?: "submission" | "manual" | "retry" | "seed"; triggeredBy?: string | null; provider?: AIProvider | null } = {},
): Promise<InvestigationOutcome> {
  const provider = opts.provider === undefined ? createDefaultProvider() : opts.provider;
  const sql = getSql();

  const [report] = await sql<InvestigationReport[]>`
    select id, reference, title, description, category, location_text,
           st_y(location::geometry) as latitude, st_x(location::geometry) as longitude,
           location_source, location_accuracy_m, occurred_at, submitted_at, is_anonymous,
           (contact_email is not null or contact_phone is not null) as has_contact,
           reporter_id is not null as is_registered, is_sensitive, is_synthetic
    from public.reports where id = ${reportId}`;
  if (!report) throw new Error(`Report ${reportId} not found`);

  const [{ attempt }] = await sql<{ attempt: number }[]>`
    select count(*)::int + 1 as attempt from public.investigations where report_id = ${reportId}`;

  // ---- Not configured: record honestly, do not fabricate anything --------
  if (!provider) {
    const investigationId = await withSystem("agent", async (tx) => {
      const [inv] = await tx<{ id: string }[]>`
        insert into public.investigations (report_id, status, trigger, attempt, error, triggered_by, started_at, completed_at)
        values (${reportId}, 'not_configured', ${opts.trigger ?? "submission"}, ${attempt},
                'AI provider is not configured (GROQ_API_KEY missing). No AI analysis was performed.',
                ${opts.triggeredBy ?? null}, now(), now())
        returning id`;
      await tx`update public.reports set investigation_status = 'not_configured', needs_human_review = true where id = ${reportId}`;
      await recordEvent(tx, {
        type: "investigation_not_configured",
        actorType: "system",
        reportId,
        investigationId: inv.id,
        summary: `${report.reference}: AI investigation unavailable (provider not configured) — queued for human review`,
      });
      return inv.id;
    });
    return {
      investigationId,
      status: "not_configured",
      agentStatuses: Object.fromEntries(AGENTS.map((a) => [a.id, "skipped"])) as Record<AgentId, string>,
    };
  }

  const investigationId = await withSystem("agent", async (tx) => {
    const [inv] = await tx<{ id: string }[]>`
      insert into public.investigations (report_id, status, trigger, attempt, provider, model, triggered_by, started_at)
      values (${reportId}, 'running', ${opts.trigger ?? "submission"}, ${attempt}, ${provider.name}, ${provider.model},
              ${opts.triggeredBy ?? null}, now())
      returning id`;
    for (const a of AGENTS) {
      await tx`insert into public.agent_findings (investigation_id, report_id, agent, status) values (${inv.id}, ${reportId}, ${a.id}, 'pending')`;
    }
    await tx`update public.reports set investigation_status = 'running' where id = ${reportId}`;
    await recordEvent(tx, {
      type: "investigation_started",
      actorType: "agent",
      reportId,
      investigationId: inv.id,
      summary: `Investigation started for ${report.reference} (attempt ${attempt}, ${AGENTS.length} agents)`,
    });
    return inv.id;
  });

  const runOpts = { timeoutMs: config.ai.agentTimeoutMs, maxAttempts: config.ai.maxAttempts };
  const statuses = {} as Record<AgentId, string>;

  async function markRunning(agent: AgentId) {
    await sql`update public.agent_findings set status = 'running', started_at = now() where investigation_id = ${investigationId} and agent = ${agent}`;
  }

  async function persist<T>(
    agent: AgentId,
    result: AgentRunResult<T> | { status: "skipped"; reason: string },
    extra: { deterministic?: unknown; inputRefs?: Record<string, unknown> } = {},
  ) {
    statuses[agent] = result.status;
    await withSystem("agent", async (tx) => {
      if (result.status === "skipped") {
        await tx`
          update public.agent_findings set status = 'skipped', error = ${result.reason},
            deterministic = ${extra.deterministic ? tx.json(extra.deterministic as never) : null},
            provenance = ${extra.deterministic ? "deterministic" : "ai_assessment"},
            input_refs = ${tx.json((extra.inputRefs ?? {}) as never)},
            started_at = coalesce(started_at, now()), completed_at = now(), duration_ms = 0
          where investigation_id = ${investigationId} and agent = ${agent}`;
        return;
      }
      await tx`
        update public.agent_findings set
          status = ${result.status}, attempts = ${result.attempts},
          output = ${result.data ? tx.json(result.data as never) : null},
          deterministic = ${extra.deterministic ? tx.json(extra.deterministic as never) : null},
          provenance = ${extra.deterministic ? "mixed" : "ai_assessment"},
          error = ${result.error}, input_refs = ${tx.json((extra.inputRefs ?? {}) as never)},
          model = ${result.model}, tokens_in = ${result.tokensIn}, tokens_out = ${result.tokensOut},
          completed_at = now(), duration_ms = ${result.durationMs}
        where investigation_id = ${investigationId} and agent = ${agent}`;
      await recordEvent(tx, {
        type: result.status === "succeeded" ? "agent_completed" : "agent_failed",
        actorType: "agent",
        reportId,
        investigationId,
        visibility: result.status === "succeeded" ? "public" : "staff",
        summary:
          result.status === "succeeded"
            ? `${AGENT_NAME[agent]} completed for ${report.reference} (${(result.durationMs / 1000).toFixed(1)} s)`
            : `${AGENT_NAME[agent]} ${result.status === "timed_out" ? "timed out" : "failed"} for ${report.reference} after ${result.attempts} attempt(s)`,
        details: { agent, attempts: result.attempts },
      });
    });
  }

  const base = reportBlock(report);

  // ---------------------------------------------------------------- Stage 1
  await markRunning("classification");
  const classification = await runAgent<ClassificationOutput>(
    provider,
    { agent: "classification", system: PROMPTS.classification, schema: classificationSchema, effort: "medium", content: [{ type: "text", text: base }] },
    runOpts,
  );
  await persist("classification", classification, { inputRefs: { report: report.reference } });
  const classificationText = classification.data ? `<classification_findings>\n${json(classification.data)}\n</classification_findings>` : "<classification_findings>unavailable: agent failed</classification_findings>";

  // ---------------------------------------------------------------- Stage 2
  // Make sure correlation reflects the current database before agents read it.
  await correlateReport(reportId).catch(() => []);

  const evidenceRows = await sql<EvidenceRecord[]>`
    select id, mime_type, file_kind, storage_backend, storage_path, metadata, metadata_flags, duplicate_of, duplicate_kind,
           st_y(exif_location::geometry) as exif_latitude, st_x(exif_location::geometry) as exif_longitude
    from public.evidence where report_id = ${reportId} order by uploaded_at`;

  const evidenceTask = (async () => {
    const images = evidenceRows.filter((e) => e.file_kind === "image");
    const deterministic = {
      files: evidenceRows.map((e) => ({
        evidence_id: e.id,
        kind: e.file_kind,
        duplicate_of: e.duplicate_of,
        duplicate_kind: e.duplicate_kind,
        metadata_flags: e.metadata_flags,
        notes: (e.metadata?.notes as string[]) ?? [],
      })),
    };
    if (images.length === 0) {
      await persist("evidence", { status: "skipped", reason: evidenceRows.length ? "No image evidence (video frame analysis not implemented)." : "No evidence files were submitted with this report." }, { deterministic, inputRefs: { evidence: evidenceRows.map((e) => e.id) } });
      return null;
    }
    await markRunning("evidence");
    const parts: ContentPart[] = [{ type: "text", text: `${base}\n${classificationText}\nPlatform metadata checks (deterministic):\n${json(deterministic)}` }];
    const loaded: string[] = [];
    for (const img of images) {
      try {
        const original = await storageFor(img.storage_backend).get(img.storage_path);
        // Downscale for the vision model (request-size limits); the stored original is untouched.
        const data = await sharp(original, { failOn: "none" }).rotate().resize(1280, 1280, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
        parts.push({ type: "text", text: `Image evidence_id=${img.id}` });
        parts.push({ type: "image", mediaType: "image/jpeg", base64: data.toString("base64") });
        loaded.push(img.id);
      } catch {
        parts.push({ type: "text", text: `Image evidence_id=${img.id} could not be loaded from storage.` });
      }
    }
    if (!loaded.length) {
      const failure: AgentRunResult<EvidenceOutput> = { status: "failed", data: null, attempts: 0, error: "Evidence files could not be loaded from storage", model: null, tokensIn: null, tokensOut: null, durationMs: 0 };
      await persist("evidence", failure, { deterministic, inputRefs: { evidence: images.map((e) => e.id) } });
      return null;
    }
    const res = await runAgent<EvidenceOutput>(provider, { agent: "evidence", system: PROMPTS.evidence, schema: evidenceSchema, effort: "medium", content: parts }, runOpts);
    await persist("evidence", res, { deterministic, inputRefs: { evidence: loaded } });
    if (res.data) {
      await withSystem("agent", async (tx) => {
        for (const item of res.data!.items) {
          if (!loaded.includes(item.evidence_id)) continue; // ignore ids the model invented
          await tx`update public.evidence set ai_analysis = ${tx.json(item as never)}, ai_relevance = ${item.relevance} where id = ${item.evidence_id}`;
        }
        await recordEvent(tx, {
          type: "evidence_analyzed",
          actorType: "agent",
          reportId,
          investigationId,
          summary: `${loaded.length} image(s) analysed for ${report.reference}: ${res.data!.items.map((i) => i.relevance.replace("_", " ")).join(", ")}`,
        });
      });
    }
    return res.data;
  })();

  const nearby = report.latitude !== null
    ? await sql<{ id: string; reference: string; title: string; category: string; location_text: string; occurred_at: Date; distance_m: number }[]>`
        select r.id, r.reference, r.title, r.category, r.location_text, r.occurred_at,
               round(st_distance(r.location, st_setsrid(st_makepoint(${report.longitude}, ${report.latitude}), 4326)::geography)) as distance_m
        from public.reports r
        where r.id <> ${reportId} and r.location is not null and r.verification_status <> 'rejected'
          and r.is_synthetic = ${report.is_synthetic}
          and st_dwithin(r.location, st_setsrid(st_makepoint(${report.longitude}, ${report.latitude}), 4326)::geography, ${correlationParams().radiusKm * 1000})
        order by distance_m limit 15`
    : [];

  const geoTask = (async () => {
    const deterministic = {
      coordinates_provided: report.latitude !== null,
      coordinates_valid:
        report.latitude !== null && Math.abs(report.latitude) <= 90 && Math.abs(report.longitude!) <= 180 && !(report.latitude === 0 && report.longitude === 0),
      location_source: report.location_source,
      accuracy_m: report.location_accuracy_m,
      search_radius_km: correlationParams().radiusKm,
      nearby_report_count: nearby.length,
      nearby_reports: nearby.map((n) => ({ reference: n.reference, category: n.category, distance_m: Number(n.distance_m), occurred_at: n.occurred_at })),
      image_gps_checks: evidenceRows
        .filter((e) => e.exif_latitude !== null && report.latitude !== null)
        .map((e) => ({ evidence_id: e.id, distance_km: Number(haversineKm(e.exif_latitude!, e.exif_longitude!, report.latitude!, report.longitude!).toFixed(2)) })),
    };
    if (report.latitude === null) {
      await persist("geospatial", { status: "skipped", reason: "No coordinates were provided; geographic analysis limited to the location text." }, { deterministic });
      return { deterministic, output: null as GeospatialOutput | null };
    }
    await markRunning("geospatial");
    const res = await runAgent<GeospatialOutput>(
      provider,
      {
        agent: "geospatial",
        system: PROMPTS.geospatial,
        schema: geospatialSchema,
        effort: "low",
        content: [{ type: "text", text: `${base}\n${classificationText}\n<deterministic_checks>\n${json(deterministic)}\n</deterministic_checks>\n<nearby_reports>\n${json(nearby.map((n) => ({ reference: n.reference, title: n.title, category: n.category, location_text: n.location_text, distance_m: Number(n.distance_m), occurred_at: n.occurred_at })))}\n</nearby_reports>` }],
      },
      runOpts,
    );
    await persist("geospatial", res, { deterministic, inputRefs: { nearby_reports: nearby.map((n) => n.reference) } });
    return { deterministic, output: res.data };
  })();

  const corroborationTask = (async () => {
    const related = await sql<{ id: string; reference: string; title: string; description: string; category: string; location_text: string; occurred_at: Date; relationship_type: string; score: number; explanation: string; components: Record<string, unknown>; same_source: boolean }[]>`
      select o.id, o.reference, o.title, o.description, o.category, o.location_text, o.occurred_at,
             rr.relationship_type, rr.score, rr.explanation, rr.components,
             (coalesce(o.reporter_id::text, o.submitter_fingerprint) = (select coalesce(t.reporter_id::text, t.submitter_fingerprint) from public.reports t where t.id = ${reportId})) as same_source
      from public.report_relationships rr
      join public.reports o on o.id = case when rr.report_a = ${reportId} then rr.report_b else rr.report_a end
      where (rr.report_a = ${reportId} or rr.report_b = ${reportId}) and rr.status <> 'rejected_by_reviewer'
      order by rr.score desc limit 12`;
    const deterministic = {
      candidates: related.map((r) => ({ reference: r.reference, relationship_type: r.relationship_type, score: r.score, same_source: r.same_source, explanation: r.explanation })),
      external_sources_integrated: false,
    };
    if (!related.length) {
      await persist("corroboration", { status: "skipped", reason: "The correlation engine found no related reports within the configured radius, time window and threshold." }, { deterministic });
      return { deterministic, output: null as CorroborationOutput | null };
    }
    await markRunning("corroboration");
    const res = await runAgent<CorroborationOutput>(
      provider,
      {
        agent: "corroboration",
        system: PROMPTS.corroboration,
        schema: corroborationSchema,
        effort: "medium",
        content: [{ type: "text", text: `${base}\n${classificationText}\n<related_reports>\n${json(related.map((r) => ({ reference: r.reference, title: r.title, category: r.category, location_text: r.location_text, occurred_at: r.occurred_at, description: r.description, engine_relationship: r.relationship_type, engine_score: r.score, engine_explanation: r.explanation, same_submitter_detected: r.same_source })))}\n</related_reports>` }],
      },
      runOpts,
    );
    await persist("corroboration", res, { deterministic, inputRefs: { related_reports: related.map((r) => r.reference) } });
    return { deterministic, output: res.data };
  })();

  const [evidenceOut, geo, corroboration] = await Promise.all([evidenceTask, geoTask, corroborationTask]);

  const findingsBlock = `${classificationText}
<evidence_findings>${evidenceOut ? json(evidenceOut) : statuses.evidence === "skipped" ? "no image evidence submitted" : "unavailable: agent failed"}</evidence_findings>
<geospatial_findings>${json({ deterministic: geo.deterministic, assessment: geo.output ?? (statuses.geospatial === "skipped" ? "skipped: no coordinates" : "unavailable: agent failed") })}</geospatial_findings>
<corroboration_findings>${json({ deterministic: corroboration.deterministic, assessment: corroboration.output ?? (statuses.corroboration === "skipped" ? "no related reports found" : "unavailable: agent failed") })}</corroboration_findings>`;

  // ---------------------------------------------------------------- Stage 3
  await markRunning("threat");
  const threat = await runAgent<ThreatOutput>(
    provider,
    { agent: "threat", system: PROMPTS.threat, schema: threatSchema, effort: "medium", content: [{ type: "text", text: `${base}\n${findingsBlock}` }] },
    runOpts,
  );
  await persist("threat", threat);

  // ---------------------------------------------------------------- Stage 4
  let lead: AgentRunResult<LeadOutput> | null = null;
  if (!classification.data && !threat.data) {
    await persist("lead", { status: "skipped", reason: "Synthesis skipped: both the classification and threat assessment agents failed." });
  } else {
    await markRunning("lead");
    const failed = (Object.entries(statuses) as [AgentId, string][]).filter(([, s]) => s === "failed" || s === "timed_out").map(([a]) => AGENT_NAME[a]);
    lead = await runAgent<LeadOutput>(
      provider,
      {
        agent: "lead",
        system: PROMPTS.lead,
        schema: leadSchema,
        effort: "high",
        content: [{ type: "text", text: `${base}\n${findingsBlock}\n<threat_findings>${threat.data ? json(threat.data) : "unavailable: agent failed"}</threat_findings>\n<agent_failures>${failed.length ? failed.join(", ") : "none"}</agent_failures>` }],
      },
      runOpts,
    );
    await persist("lead", lead, { inputRefs: { agents: Object.keys(statuses) } });
  }

  // ---------------------------------------------------------------- Outcome
  const failures = Object.values(statuses).filter((s) => s === "failed" || s === "timed_out").length;
  const anySucceeded = Object.values(statuses).some((s) => s === "succeeded");
  const status: InvestigationOutcome["status"] =
    lead?.data && failures === 0 ? "completed" : anySucceeded ? "partial" : "failed";
  const severity: Severity | null = lead?.data?.severity.level ?? threat.data?.severity ?? null;
  const confidence = lead?.data ? lead.data.confidence.score : null;
  const reviewReasons: string[] = [...(lead?.data?.human_review_reasons ?? [])];
  if (severity === "HIGH" || severity === "CRITICAL") reviewReasons.push(`Severity assessed as ${severity}`);
  if (report.is_sensitive) reviewReasons.push("Sensitive category (violence/security)");
  if (confidence !== null && confidence < 0.4) reviewReasons.push("Low confidence");
  if (status !== "completed") reviewReasons.push("Investigation incomplete");
  if (evidenceRows.some((e) => e.duplicate_of)) reviewReasons.push("Duplicate evidence detected");
  if (evidenceOut?.items.some((i) => i.relevance === "unrelated" || i.inconsistencies.length > 0)) reviewReasons.push("Evidence inconsistencies");
  const needsReview = Boolean(lead?.data?.requires_human_review) || reviewReasons.length > 0;
  // AI may only RECOMMEND escalation; escalating is a human reviewer action.
  const escalationRecommended = severity === "CRITICAL" || Boolean(threat.data?.escalation_recommended);

  await withSystem("agent", async (tx) => {
    const errorText = status === "completed" ? null : (Object.entries(statuses) as [AgentId, string][]).filter(([, s]) => s === "failed" || s === "timed_out").map(([a, s]) => `${AGENT_NAME[a]}: ${s}`).join("; ") || "Synthesis unavailable";
    await tx`
      update public.investigations set status = ${status}, completed_at = now(),
        summary = ${lead?.data ? tx.json({ ...lead.data, review_reasons: [...new Set(reviewReasons)] } as never) : null},
        severity = ${severity}, confidence = ${confidence}, needs_human_review = ${needsReview}, error = ${errorText}
      where id = ${investigationId}`;
    await tx`
      update public.reports set investigation_status = ${status}, severity = ${severity}, confidence = ${confidence},
        needs_human_review = ${needsReview},
        public_visibility = case when ${geo.output?.recommended_public_precision === "approximate"} and public_visibility = 'standard'
                                 then 'restricted' else public_visibility end
      where id = ${reportId}`;
    if (severity) {
      await recordEvent(tx, {
        type: "severity_assessed",
        actorType: "agent",
        reportId,
        investigationId,
        summary: `${report.reference} assessed as ${severity} severity${confidence !== null ? ` with ${Math.round(confidence * 100)}% confidence` : " (confidence unavailable)"} — AI assessment, not confirmation`,
        details: { severity, confidence },
      });
    }
    if (needsReview) {
      await recordEvent(tx, {
        type: "human_review_requested",
        actorType: "agent",
        reportId,
        investigationId,
        summary: `Human review requested for ${report.reference}: ${[...new Set(reviewReasons)].slice(0, 3).join("; ")}`,
      });
      await notifyStaff(tx, {
        kind: escalationRecommended ? "escalation_recommended" : "review_requested",
        title: `${escalationRecommended ? "Escalation recommended — " : ""}Review ${report.reference} (${severity ?? "severity unknown"})`,
        body: [...new Set(reviewReasons)].join("; "),
        reportId,
      });
    }
    await recordEvent(tx, {
      type: status === "completed" ? "investigation_completed" : status === "partial" ? "investigation_partial" : "investigation_failed",
      actorType: "agent",
      reportId,
      investigationId,
      summary:
        status === "completed"
          ? `Investigation completed for ${report.reference}`
          : status === "partial"
            ? `Investigation for ${report.reference} is INCOMPLETE: ${failures} agent(s) did not finish${lead?.data ? "" : " and no synthesis was produced"}`
            : `Investigation for ${report.reference} failed: no synthesis was produced`,
    });
  });

  return { investigationId, status, agentStatuses: statuses };
}

/** Mark the report as queued and run the investigation (used by API `after()` hooks). */
export async function queueAndRun(reportId: string, opts: Parameters<typeof runInvestigation>[1] = {}) {
  try {
    return await runInvestigation(reportId, opts);
  } catch (err) {
    console.error("investigation crashed", reportId, err);
    await withSystem("agent", async (tx) => {
      await tx`update public.reports set investigation_status = 'failed', needs_human_review = true where id = ${reportId}`;
      await tx`update public.investigations set status = 'failed', error = ${String((err as Error).message).slice(0, 500)}, completed_at = now()
               where report_id = ${reportId} and status in ('queued','running')`;
      await tx`update public.agent_findings set status = 'failed', error = 'Investigation aborted', completed_at = now()
               where report_id = ${reportId} and status in ('pending','running')`;
    }).catch(() => {});
    return null;
  }
}
