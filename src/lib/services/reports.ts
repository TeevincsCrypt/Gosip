import "server-only";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { config, isAiConfigured } from "@/lib/config";
import { getSql } from "@/lib/db/client";
import { isStaff, withActor, withSystem, type Actor, type Tx } from "@/lib/db/context";
import { ALLOWED_UPLOAD_TYPES, type ReportSubmission } from "@/lib/domain/schemas";
import { categoryLabel } from "@/lib/domain/constants";
import type { PublicReport } from "@/lib/domain/types";
import {
  extractImageMetadata,
  fileKind,
  metadataFlags,
  perceptualHash,
  sha256Hex,
  sniffMime,
} from "@/lib/evidence/processing";
import { hammingHex, NEAR_DUPLICATE_HAMMING } from "@/lib/correlation/engine";
import { getStorage } from "@/lib/storage";
import { recordEvent } from "./events";

export class SubmissionError extends Error {
  constructor(message: string, readonly status = 400, readonly field?: string) {
    super(message);
    this.name = "SubmissionError";
  }
}

export interface UploadedFile {
  name: string;
  type: string;
  data: Buffer;
}

export function newReportReference(now = new Date()): string {
  const d = now.toISOString().slice(2, 10).replace(/-/g, "");
  return `GSP-${d}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export function submitterFingerprint(ip: string | null, userAgent: string | null): string | null {
  const secret = config.fingerprintSecret;
  if (!secret || !ip) return null;
  return createHmac("sha256", secret).update(`${ip}|${userAgent ?? ""}`).digest("hex").slice(0, 32);
}

interface PreparedEvidence {
  id: string;
  originalName: string;
  mime: string;
  kind: "image" | "video" | "other";
  data: Buffer;
  sha256: string;
  phash: string | null;
  width: number | null;
  height: number | null;
  metadata: Record<string, unknown>;
  flags: string[];
  exifGps: { latitude: number; longitude: number } | null;
  duplicateOf: string | null;
  duplicateKind: "exact" | "near" | null;
  duplicateDistance: number | null;
}

async function prepareEvidence(files: UploadedFile[], input: ReportSubmission): Promise<PreparedEvidence[]> {
  if (files.length > config.storage.maxFiles) {
    throw new SubmissionError(`At most ${config.storage.maxFiles} files can be attached`, 400, "files");
  }
  const prepared: PreparedEvidence[] = [];
  for (const file of files) {
    if (file.data.length === 0) throw new SubmissionError(`"${file.name}" is empty`, 400, "files");
    if (file.data.length > config.storage.maxFileBytes) {
      throw new SubmissionError(
        `"${file.name}" exceeds the ${Math.round(config.storage.maxFileBytes / 1024 / 1024)} MB limit`,
        413,
        "files",
      );
    }
    const sniffed = sniffMime(file.data);
    if (!sniffed || !(ALLOWED_UPLOAD_TYPES as readonly string[]).includes(sniffed)) {
      throw new SubmissionError(`"${file.name}" is not a supported image or video (JPEG, PNG, WebP, MP4, MOV, WebM)`, 415, "files");
    }
    const kind = fileKind(sniffed);
    let phash: string | null = null;
    let width: number | null = null;
    let height: number | null = null;
    let metadata: Record<string, unknown> = {};
    let flags: string[] = [];
    let exifGps: PreparedEvidence["exifGps"] = null;
    if (kind === "image") {
      try {
        phash = await perceptualHash(file.data);
        const meta = await extractImageMetadata(file.data);
        width = meta.width;
        height = meta.height;
        exifGps = meta.gps;
        const assessed = metadataFlags(meta, {
          occurredAt: input.occurredAt,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
        });
        flags = assessed.flags;
        metadata = {
          format: meta.format,
          has_exif: meta.hasExif,
          camera_make: meta.cameraMake,
          camera_model: meta.cameraModel,
          software: meta.software,
          captured_at: meta.capturedAt,
          has_gps: Boolean(meta.gps),
          notes: assessed.notes,
        };
      } catch {
        throw new SubmissionError(`"${file.name}" could not be decoded as an image`, 422, "files");
      }
    } else {
      flags = ["not_ai_analyzed"];
      metadata = { notes: ["Video stored with integrity hash. Frame-level AI analysis is not implemented in this version."] };
    }
    prepared.push({
      id: randomUUID(),
      originalName: file.name.slice(0, 200) || "upload",
      mime: sniffed,
      kind,
      data: file.data,
      sha256: sha256Hex(file.data),
      phash,
      width,
      height,
      metadata,
      flags,
      exifGps,
      duplicateOf: null,
      duplicateKind: null,
      duplicateDistance: null,
    });
  }

  // Duplicate detection against everything previously submitted.
  if (prepared.length) {
    const sql = getSql();
    const known = await sql<{ id: string; sha256: string; phash: string | null }[]>`
      select id, sha256, phash from public.evidence
      where sha256 in ${sql(prepared.map((p) => p.sha256))} or phash is not null
      order by uploaded_at asc limit 5000`;
    for (const p of prepared) {
      const exact = known.find((k) => k.sha256 === p.sha256);
      if (exact) {
        p.duplicateOf = exact.id;
        p.duplicateKind = "exact";
        p.duplicateDistance = 0;
        continue;
      }
      if (!p.phash) continue;
      let best: { id: string; d: number } | null = null;
      for (const k of known) {
        if (!k.phash) continue;
        const d = hammingHex(p.phash, k.phash);
        if (d <= NEAR_DUPLICATE_HAMMING && (!best || d < best.d)) best = { id: k.id, d };
      }
      if (best) {
        p.duplicateOf = best.id;
        p.duplicateKind = "near";
        p.duplicateDistance = best.d;
      }
    }
  }
  return prepared;
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

export interface CreatedReport {
  id: string;
  reference: string;
  evidenceCount: number;
  duplicateEvidence: number;
  investigationStatus: "queued" | "not_configured";
}

/**
 * Submit a community report. The report and evidence rows are inserted in a
 * transaction running as the submitter's restricted role, so the database's
 * insert policies apply (no self-verification, no synthetic flag, etc.).
 */
export async function createReport(
  actor: Actor,
  input: ReportSubmission,
  files: UploadedFile[],
  meta: { fingerprint: string | null; synthetic?: boolean; occurredAtOverride?: Date } = { fingerprint: null },
): Promise<CreatedReport> {
  const evidence = await prepareEvidence(files, input);
  const reportId = randomUUID();
  const reference = newReportReference();
  const storage = evidence.length ? getStorage() : null;

  for (const e of evidence) {
    const key = `reports/${reportId}/${e.id}.${EXT[e.mime] ?? "bin"}`;
    try {
      await storage!.put(key, e.data, e.mime);
    } catch (err) {
      throw new SubmissionError(`Evidence upload failed: ${(err as Error).message}. The report was not submitted; please retry.`, 502, "files");
    }
    (e as PreparedEvidence & { key: string }).key = key;
  }

  const anonymous = actor.kind === "anonymous" ? input.anonymous : input.anonymous;
  const reporterId = actor.kind === "user" && !anonymous ? actor.userId : null;
  const hasCoords = input.latitude != null && input.longitude != null;
  const investigationStatus = isAiConfigured() ? "queued" : "not_configured";

  const insert = async (tx: Tx) => {
    await tx`
      insert into public.reports (
        id, reference, title, description, category, location_text, location, location_source,
        location_accuracy_m, occurred_at, reporter_id, is_anonymous, contact_name, contact_phone, contact_email,
        submitter_fingerprint, investigation_status, is_synthetic)
      values (
        ${reportId}, ${reference}, ${input.title}, ${input.description}, ${input.category}, ${input.locationText},
        ${hasCoords ? tx`st_setsrid(st_makepoint(${input.longitude!}, ${input.latitude!}), 4326)::geography` : null},
        ${hasCoords ? input.locationSource : "none"}, ${input.locationAccuracyM ?? null}, ${meta.occurredAtOverride ?? input.occurredAt},
        ${reporterId}, ${anonymous},
        ${anonymous ? null : input.contactName || null}, ${anonymous ? null : input.contactPhone || null},
        ${anonymous ? null : input.contactEmail || null},
        ${meta.fingerprint}, ${investigationStatus}, ${meta.synthetic ?? false})`;
    for (const e of evidence as (PreparedEvidence & { key: string })[]) {
      await tx`
        insert into public.evidence (
          id, report_id, original_filename, mime_type, file_kind, size_bytes, storage_backend, storage_path,
          sha256, phash, width, height, metadata, metadata_flags, exif_location,
          duplicate_of, duplicate_kind, duplicate_distance)
        values (
          ${e.id}, ${reportId}, ${e.originalName}, ${e.mime}, ${e.kind}, ${e.data.length}, ${storage!.backend}, ${e.key},
          ${e.sha256}, ${e.phash}, ${e.width}, ${e.height}, ${tx.json(e.metadata as never)}, ${e.flags},
          ${e.exifGps ? tx`st_setsrid(st_makepoint(${e.exifGps.longitude}, ${e.exifGps.latitude}), 4326)::geography` : null},
          ${e.duplicateOf}, ${e.duplicateKind}, ${e.duplicateDistance})`;
    }
  };

  if (meta.synthetic) {
    // Synthetic demo data is created by the trusted seed process only.
    await withSystem("system", insert);
  } else {
    await withActor(actor, insert);
  }

  await withSystem("system", async (tx) => {
    await recordEvent(tx, {
      type: "report_submitted",
      actorType: "user",
      actorId: reporterId,
      reportId,
      summary: `New ${categoryLabel(input.category).toLowerCase()} report ${reference} submitted (${input.locationText})${meta.synthetic ? " [synthetic demo]" : ""}`,
      details: { anonymous, evidence_count: evidence.length, synthetic: meta.synthetic ?? false },
    });
    if (evidence.length) {
      await recordEvent(tx, {
        type: "evidence_uploaded",
        actorType: "user",
        reportId,
        summary: `${evidence.length} evidence file(s) attached to ${reference}`,
        details: { evidence_ids: evidence.map((e) => e.id) },
      });
    }
    for (const e of evidence.filter((x) => x.duplicateOf)) {
      await recordEvent(tx, {
        type: "duplicate_evidence_detected",
        actorType: "system",
        reportId,
        visibility: "staff",
        summary: `${e.duplicateKind === "exact" ? "Identical" : "Near-identical"} image previously submitted (evidence ${e.id.slice(0, 8)})`,
        details: { evidence_id: e.id, duplicate_of: e.duplicateOf, distance: e.duplicateDistance },
      });
    }
  });

  return {
    id: reportId,
    reference,
    evidenceCount: evidence.length,
    duplicateEvidence: evidence.filter((e) => e.duplicateOf).length,
    investigationStatus,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface ReportFilters {
  category?: string[];
  severity?: string[];
  verification?: string[];
  investigation?: string[];
  q?: string;
  clusterId?: string;
  includeSynthetic?: boolean;
  limit?: number;
  offset?: number;
}

export async function listReports(actor: Actor, f: ReportFilters = {}): Promise<{ items: PublicReport[]; total: number }> {
  return withActor(actor, async (tx) => {
    const where = [tx`true`];
    if (f.category?.length) where.push(tx`category in ${tx(f.category)}`);
    if (f.severity?.length) where.push(tx`severity in ${tx(f.severity)}`);
    if (f.verification?.length) where.push(tx`verification_status in ${tx(f.verification)}`);
    if (f.investigation?.length) where.push(tx`investigation_status in ${tx(f.investigation)}`);
    if (f.clusterId) where.push(tx`cluster_id = ${f.clusterId}`);
    if (f.includeSynthetic === false) where.push(tx`not is_synthetic`);
    if (f.q) {
      const like = `%${f.q.replace(/[%_]/g, "")}%`;
      where.push(tx`(title ilike ${like} or description ilike ${like} or location_text ilike ${like} or reference ilike ${like})`);
    }
    const cond = where.reduce((acc, w) => tx`${acc} and ${w}`);
    const limit = Math.min(Math.max(f.limit ?? 50, 1), 500);
    const items = await tx<PublicReport[]>`
      select * from public.reports_public where ${cond}
      order by occurred_at desc limit ${limit} offset ${f.offset ?? 0}`;
    const [{ count }] = await tx<{ count: number }[]>`select count(*)::int as count from public.reports_public where ${cond}`;
    return { items, total: count };
  });
}

export async function getReportDetail(actor: Actor, id: string) {
  const staff = isStaff(actor);
  return withActor(actor, async (tx) => {
    const [report] = await tx<PublicReport[]>`select * from public.reports_public where id = ${id}`;
    let staffExtras: Record<string, unknown> | null = null;
    if (staff || actor.kind === "user") {
      const [row] = await tx`
        select contact_name, contact_phone, contact_email, reporter_id, public_visibility, lifecycle_status,
               st_y(location::geometry) as exact_latitude, st_x(location::geometry) as exact_longitude,
               location_accuracy_m
        from public.reports where id = ${id}`;
      staffExtras = row ?? null; // RLS: visible only to staff or the original reporter
    }
    if (!report && !staffExtras) return null;
    const base = report ?? (staff ? (await tx<PublicReport[]>`
      select r.id, r.reference, r.title, r.description, r.category, r.location_text,
        st_y(r.location::geometry) as latitude, st_x(r.location::geometry) as longitude, 'precise' as location_precision,
        r.location_source, r.occurred_at, r.submitted_at, r.is_anonymous, r.reporter_id is not null as is_registered_reporter,
        r.is_synthetic, r.is_sensitive, r.verification_status, r.lifecycle_status, r.investigation_status, r.severity,
        r.confidence, r.priority_escalated, r.needs_human_review, r.created_at, r.updated_at, null::uuid as cluster_id,
        0 as evidence_count
      from public.reports r where r.id = ${id}`)[0] : null);
    if (!base) return null;

    const evidence = staff
      ? await tx`select id, report_id, original_filename, mime_type, file_kind, size_bytes, sha256, phash, width, height,
                        metadata, metadata_flags, ai_analysis, ai_relevance, duplicate_of, duplicate_kind, duplicate_distance,
                        review_status, uploaded_at,
                        st_y(exif_location::geometry) as exif_latitude, st_x(exif_location::geometry) as exif_longitude
                 from public.evidence where report_id = ${id} order by uploaded_at`
      : await tx`select * from public.evidence_public where report_id = ${id} order by uploaded_at`;

    const investigations = staff
      ? await tx`select * from public.investigations where report_id = ${id} order by created_at desc limit 10`
      : await tx`select * from public.investigations_public where report_id = ${id} order by created_at desc limit 10`;
    const latest = investigations[0];
    const findings = latest
      ? staff
        ? await tx`select * from public.agent_findings where investigation_id = ${latest.id} order by created_at`
        : await tx`select * from public.agent_findings_public where investigation_id = ${latest.id} order by started_at nulls last`
      : [];

    const relationships = await tx`
      select rr.id, rr.report_a, rr.report_b, rr.relationship_type, rr.score, rr.components, rr.distance_m,
             rr.time_delta_minutes, rr.explanation, rr.source, rr.status,
             o.id as other_id, o.reference as other_reference, o.title as other_title, o.category as other_category,
             o.location_text as other_location, o.occurred_at as other_occurred_at, o.verification_status as other_verification
      from public.report_relationships rr
      join public.reports_public o on o.id = case when rr.report_a = ${id} then rr.report_b else rr.report_a end
      where (rr.report_a = ${id} or rr.report_b = ${id})
      order by rr.score desc`;

    const clusterId = base.cluster_id;
    const [cluster] = clusterId
      ? await tx`select id, reference, title, primary_category, report_count, independent_source_count, explanation, status,
                        st_y(centroid::geometry) as latitude, st_x(centroid::geometry) as longitude, radius_m, is_synthetic
                 from public.incident_clusters where id = ${clusterId}`
      : [];

    const timeline = await tx`
      select id, event_type, actor_type, summary, details, visibility, created_at
      from public.incident_events where report_id = ${id} or (cluster_id = ${clusterId ?? null}::uuid and report_id is null)
      order by created_at asc limit 300`;

    const reviews = staff
      ? await tx`select h.*, p.display_name as reviewer_name from public.human_reviews h
                 join public.profiles p on p.id = h.reviewer_id where h.report_id = ${id} order by h.created_at desc`
      : [];

    return {
      report: base,
      staff: staff ? staffExtras : null,
      isOwnReport: Boolean(staffExtras && actor.kind === "user" && staffExtras.reporter_id === actor.userId),
      evidence,
      investigation: latest ?? null,
      investigationHistory: investigations.map((i) => ({ id: i.id, status: i.status, trigger: i.trigger, created_at: i.created_at, completed_at: i.completed_at })),
      findings,
      relationships,
      cluster: cluster ?? null,
      timeline,
      reviews,
      viewer: { staff, role: actor.kind === "user" ? actor.role : "anonymous" },
    };
  });
}

export type ReportDetail = NonNullable<Awaited<ReturnType<typeof getReportDetail>>>;
