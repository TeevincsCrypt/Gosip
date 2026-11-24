import "server-only";
import { config } from "@/lib/config";
import { withSystem, type Tx } from "@/lib/db/context";
import { categoryLabel, type Category } from "@/lib/domain/constants";
import {
  assignClusterIds,
  centroid,
  connectedComponents,
  correlate,
  independentSourceCount,
  type CorrelationParams,
  type CorrelationReport,
  type PairScore,
} from "@/lib/correlation/engine";
import { recordEvent } from "./events";

export function correlationParams(): CorrelationParams {
  return {
    radiusKm: config.correlation.radiusKm,
    windowHours: config.correlation.windowHours,
    threshold: config.correlation.threshold,
  };
}

interface ReportRow {
  id: string;
  reference: string;
  title: string;
  description: string;
  category: Category;
  location_text: string;
  latitude: number | null;
  longitude: number | null;
  occurred_at: Date;
  submitter_key: string | null;
  is_synthetic: boolean;
  evidence: { id: string; sha256: string; phash: string | null }[] | null;
}

function toCorrelation(r: ReportRow): CorrelationReport {
  return {
    id: r.id,
    reference: r.reference,
    title: r.title,
    description: r.description,
    category: r.category,
    locationText: r.location_text,
    latitude: r.latitude,
    longitude: r.longitude,
    occurredAt: new Date(r.occurred_at),
    submitterKey: r.submitter_key,
    evidence: r.evidence ?? [],
  };
}

const REPORT_COLUMNS = (tx: Tx) => tx`
  r.id, r.reference, r.title, r.description, r.category, r.location_text,
  st_y(r.location::geometry) as latitude, st_x(r.location::geometry) as longitude,
  r.occurred_at, coalesce(r.reporter_id::text, r.submitter_fingerprint) as submitter_key, r.is_synthetic,
  (select coalesce(json_agg(json_build_object('id', e.id, 'sha256', e.sha256, 'phash', e.phash)), '[]'::json)
     from public.evidence e where e.report_id = r.id) as evidence`;

/**
 * Score a report against every candidate inside the search radius and time
 * window (PostGIS pre-filter), and persist relationships above threshold.
 */
export async function correlateReport(reportId: string, params = correlationParams()): Promise<PairScore[]> {
  return withSystem("system", async (tx) => {
    const [target] = await tx<ReportRow[]>`select ${REPORT_COLUMNS(tx)} from public.reports r where r.id = ${reportId}`;
    if (!target) throw new Error(`Report ${reportId} not found`);
    if (target.latitude === null || target.longitude === null) return [];

    const candidates = await tx<ReportRow[]>`
      select ${REPORT_COLUMNS(tx)}
      from public.reports r
      where r.id <> ${reportId}
        and r.location is not null
        and r.verification_status <> 'rejected'
        and r.lifecycle_status <> 'archived'
        and r.is_synthetic = ${target.is_synthetic}
        and st_dwithin(r.location, st_setsrid(st_makepoint(${target.longitude}, ${target.latitude}), 4326)::geography, ${params.radiusKm * 1000})
        and abs(extract(epoch from (r.occurred_at - ${target.occurred_at}::timestamptz))) <= ${params.windowHours * 3600}
      limit 200`;

    const scores = correlate(toCorrelation(target), candidates.map(toCorrelation), params);
    const refById = new Map(candidates.map((c) => [c.id, c.reference]));

    for (const s of scores) {
      const [existing] = await tx<{ id: string; status: string; source: string }[]>`
        select id, status, source from public.report_relationships where report_a = ${s.a} and report_b = ${s.b}`;
      // Human decisions are authoritative and never overwritten by the engine.
      if (existing && (existing.source === "human" || existing.status !== "active")) continue;
      if (!s.eligible) {
        if (existing) await tx`delete from public.report_relationships where id = ${existing.id}`;
        continue;
      }
      const otherId = s.a === reportId ? s.b : s.a;
      await tx`
        insert into public.report_relationships
          (report_a, report_b, relationship_type, score, components, distance_m, time_delta_minutes, explanation, source)
        values (${s.a}, ${s.b}, ${s.type!}, ${s.score}, ${tx.json({ ...s.components, shared_terms: s.sharedTerms, image_matches: s.imageMatches } as never)},
                ${s.distanceKm === null ? null : Math.round(s.distanceKm * 1000)}, ${s.deltaMinutes}, ${s.explanation}, 'engine')
        on conflict (report_a, report_b) do update set
          relationship_type = excluded.relationship_type, score = excluded.score, components = excluded.components,
          distance_m = excluded.distance_m, time_delta_minutes = excluded.time_delta_minutes, explanation = excluded.explanation`;
      if (!existing) {
        await recordEvent(tx, {
          type: "related_report_discovered",
          actorType: "system",
          reportId,
          summary: `${target.reference} linked to ${refById.get(otherId) ?? "another report"} as ${s.type!.replace("_", " ")} (score ${s.score.toFixed(2)})`,
          details: { other_report_id: otherId, score: s.score, type: s.type },
        });
      }
    }
    await recomputeClusters(tx, params);
    return scores;
  });
}

/**
 * Rebuild clusters as connected components over active relationships,
 * keeping cluster identities stable and recording what changed.
 */
export async function recomputeClusters(tx: Tx, params = correlationParams()): Promise<void> {
  const edges = await tx<{ a: string; b: string }[]>`
    select rr.report_a as a, rr.report_b as b
    from public.report_relationships rr
    join public.reports ra on ra.id = rr.report_a
    join public.reports rb on rb.id = rr.report_b
    where rr.status in ('active','confirmed_by_reviewer')
      and ra.verification_status <> 'rejected' and rb.verification_status <> 'rejected'
      and ra.lifecycle_status <> 'archived' and rb.lifecycle_status <> 'archived'`;
  const nodes = [...new Set(edges.flatMap((e) => [e.a, e.b]))];
  const components = connectedComponents(nodes, edges).filter((c) => c.length >= 2);

  const memberships = await tx<{ report_id: string; cluster_id: string }[]>`
    select cr.report_id, cr.cluster_id from public.cluster_relationships cr
    join public.incident_clusters c on c.id = cr.cluster_id
    where cr.status = 'active' and c.status <> 'dismissed'`;
  const existing = new Map(memberships.map((m) => [m.report_id, m.cluster_id]));
  const assignments = assignClusterIds(components, existing);
  const keptClusterIds = new Set<string>();

  for (const { members, clusterId } of assignments) {
    const rows = await tx<ReportRow[]>`select ${REPORT_COLUMNS(tx)} from public.reports r where r.id in ${tx(members)}`;
    const reports = rows.map(toCorrelation).sort((x, y) => x.occurredAt.getTime() - y.occurredAt.getTime());
    const located = reports.filter((r) => r.latitude !== null && r.longitude !== null) as (CorrelationReport & { latitude: number; longitude: number })[];
    const c = centroid(located);
    const categoryCounts = new Map<Category, number>();
    for (const r of reports) categoryCounts.set(r.category, (categoryCounts.get(r.category) ?? 0) + 1);
    const primary = [...categoryCounts.entries()].sort((x, y) => y[1] - x[1])[0][0];
    const independent = independentSourceCount(reports);
    const isSynthetic = rows.every((r) => r.is_synthetic);
    const title = `${categoryLabel(primary)} — ${reports[0].locationText}`;
    const explanation =
      `${reports.length} reports linked within ${c.radiusKm.toFixed(1)} km of a common centre between ` +
      `${reports[0].occurredAt.toISOString()} and ${reports[reports.length - 1].occurredAt.toISOString()}. ` +
      `${independent} appear to come from independent sources. Reports are connected when their pairwise score ` +
      `(geography 30%, time 20%, category 20%, text 20%, imagery 10%) meets the ${params.threshold} threshold within ` +
      `${params.radiusKm} km and ${params.windowHours} h.`;
    const scoring = { ...params, weights: { geo: 0.3, temporal: 0.2, category: 0.2, semantic: 0.2, evidence: 0.1 } };

    let id = clusterId;
    if (id) {
      const [before] = await tx<{ report_count: number }[]>`select report_count from public.incident_clusters where id = ${id}`;
      await tx`
        update public.incident_clusters set
          title = ${title}, primary_category = ${primary},
          centroid = st_setsrid(st_makepoint(${c.longitude}, ${c.latitude}), 4326)::geography,
          radius_m = ${Math.round(c.radiusKm * 1000)}, first_reported_at = ${reports[0].occurredAt},
          last_reported_at = ${reports[reports.length - 1].occurredAt}, report_count = ${reports.length},
          independent_source_count = ${independent}, explanation = ${explanation}, scoring = ${tx.json(scoring as never)},
          is_synthetic = ${isSynthetic}
        where id = ${id}`;
      if (before && before.report_count !== reports.length) {
        await recordEvent(tx, {
          type: "cluster_updated",
          actorType: "system",
          clusterId: id,
          summary: `Cluster "${title}" now contains ${reports.length} reports (${independent} independent sources)`,
          details: { report_count: reports.length, previous_count: before.report_count },
        });
      }
    } else {
      const [created] = await tx<{ id: string; reference: string }[]>`
        insert into public.incident_clusters
          (reference, title, primary_category, centroid, radius_m, first_reported_at, last_reported_at,
           report_count, independent_source_count, explanation, scoring, is_synthetic)
        values (app.new_reference('CLU'), ${title}, ${primary},
                st_setsrid(st_makepoint(${c.longitude}, ${c.latitude}), 4326)::geography,
                ${Math.round(c.radiusKm * 1000)}, ${reports[0].occurredAt}, ${reports[reports.length - 1].occurredAt},
                ${reports.length}, ${independent}, ${explanation}, ${tx.json(scoring as never)}, ${isSynthetic})
        returning id, reference`;
      id = created.id;
      await recordEvent(tx, {
        type: "cluster_created",
        actorType: "system",
        clusterId: id,
        summary: `Incident cluster ${created.reference} created: ${reports.length} related ${categoryLabel(primary).toLowerCase()} reports near ${reports[0].locationText}`,
        details: { report_ids: members },
      });
    }
    keptClusterIds.add(id);

    for (const r of reports) {
      const prev = existing.get(r.id);
      if (prev && prev !== id) {
        await tx`update public.cluster_relationships set status = 'removed' where report_id = ${r.id} and cluster_id = ${prev} and status = 'active'`;
      }
      await tx`
        insert into public.cluster_relationships (cluster_id, report_id, status, explanation, source)
        values (${id}, ${r.id}, 'active', ${"Connected to other cluster members through scored relationships."}, 'engine')
        on conflict (cluster_id, report_id) do update set status = 'active'`;
    }

    // Independent corroboration lifts unverified reports to "corroborated".
    // Human decisions (verified / disputed / rejected) are never touched.
    if (independent >= 2) {
      const lifted = await tx<{ id: string; reference: string }[]>`
        update public.reports set verification_status = 'corroborated'
        where id in ${tx(members)} and verification_status = 'unverified'
        returning id, reference`;
      for (const r of lifted) {
        await recordEvent(tx, {
          type: "corroboration_status_changed",
          actorType: "system",
          reportId: r.id,
          clusterId: id,
          summary: `${r.reference} marked corroborated: ${independent} independent sources in cluster`,
        });
      }
    } else {
      const demoted = await tx<{ id: string; reference: string }[]>`
        update public.reports set verification_status = 'unverified'
        where id in ${tx(members)} and verification_status = 'corroborated'
        returning id, reference`;
      for (const r of demoted) {
        await recordEvent(tx, {
          type: "corroboration_status_changed",
          actorType: "system",
          reportId: r.id,
          clusterId: id,
          summary: `${r.reference} returned to unverified: cluster has fewer than 2 independent sources`,
        });
      }
    }
  }

  // Memberships for reports no longer in any component are removed.
  const allMembers = new Set(assignments.flatMap((a) => a.members));
  for (const m of memberships) {
    if (!allMembers.has(m.report_id)) {
      await tx`update public.cluster_relationships set status = 'removed' where report_id = ${m.report_id} and cluster_id = ${m.cluster_id} and status = 'active'`;
      const demoted = await tx<{ reference: string }[]>`
        update public.reports set verification_status = 'unverified'
        where id = ${m.report_id} and verification_status = 'corroborated' returning reference`;
      if (demoted.length) {
        await recordEvent(tx, {
          type: "corroboration_status_changed",
          actorType: "system",
          reportId: m.report_id,
          summary: `${demoted[0].reference} returned to unverified: no longer part of a corroborated cluster`,
        });
      }
    }
  }
  // Clusters with no remaining members are dismissed (kept for audit).
  const orphaned = [...new Set(memberships.map((m) => m.cluster_id))].filter((cid) => !keptClusterIds.has(cid));
  if (orphaned.length) {
    await tx`update public.incident_clusters set status = 'dismissed', report_count = 0 where id in ${tx(orphaned)} and status = 'active'`;
  }
}

export async function recomputeAllClusters(): Promise<void> {
  await withSystem("system", (tx) => recomputeClusters(tx));
}
