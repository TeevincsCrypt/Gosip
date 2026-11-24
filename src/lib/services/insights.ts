import "server-only";
import { isStaff, withActor, type Actor } from "@/lib/db/context";

/** Command-centre statistics. Every number is computed from database rows the viewer may see. */
export async function getDashboardStats(actor: Actor, opts: { includeSynthetic?: boolean } = {}) {
  const includeSynthetic = opts.includeSynthetic ?? true;
  return withActor(actor, async (tx) => {
    const syn = includeSynthetic ? tx`true` : tx`not is_synthetic`;
    const [counts] = await tx<Record<string, number>[]>`
      select
        count(*)::int as total,
        count(*) filter (where lifecycle_status = 'active')::int as active,
        count(*) filter (where investigation_status in ('queued','running'))::int as under_investigation,
        count(*) filter (where verification_status = 'corroborated')::int as corroborated,
        count(*) filter (where verification_status = 'verified')::int as verified,
        count(*) filter (where verification_status = 'disputed')::int as disputed,
        count(*) filter (where lifecycle_status = 'active' and (severity in ('HIGH','CRITICAL') or priority_escalated))::int as high_priority,
        count(*) filter (where lifecycle_status = 'resolved' and updated_at > now() - interval '7 days')::int as recently_resolved,
        count(*) filter (where needs_human_review and lifecycle_status = 'active')::int as awaiting_review,
        count(*) filter (where is_synthetic)::int as synthetic,
        count(*) filter (where submitted_at > now() - interval '24 hours')::int as last_24h
      from public.reports_public where ${syn}`;
    const [clusters] = await tx<{ active: number; reports_in_clusters: number }[]>`
      select count(*)::int as active, coalesce(sum(report_count), 0)::int as reports_in_clusters
      from public.incident_clusters where status = 'active' and (${includeSynthetic} or not is_synthetic)`;
    const byCategory = await tx<{ category: string; count: number }[]>`
      select category, count(*)::int as count from public.reports_public where ${syn} group by category order by count desc`;
    const bySeverity = await tx<{ severity: string | null; count: number }[]>`
      select severity, count(*)::int as count from public.reports_public where ${syn} group by severity`;
    const activity = await tx<{ day: string; count: number }[]>`
      select to_char(d.day, 'YYYY-MM-DD') as day, coalesce(c.count, 0)::int as count
      from generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') as d(day)
      left join (
        select date_trunc('day', submitted_at) as day, count(*) as count from public.reports_public where ${syn} group by 1
      ) c on c.day = d.day order by d.day`;
    const hotspots = await tx<{ lat: number; lng: number; count: number; place: string; max_severity: string | null }[]>`
      select round(latitude::numeric, 0)::float as lat, round(longitude::numeric, 0)::float as lng, count(*)::int as count,
             mode() within group (order by location_text) as place,
             (array_agg(severity order by case severity when 'CRITICAL' then 4 when 'HIGH' then 3 when 'MODERATE' then 2 when 'LOW' then 1 else 0 end desc))[1] as max_severity
      from public.reports_public where latitude is not null and ${syn}
      group by 1, 2 order by count desc limit 8`;
    const activeClusters = await tx`
      select id, reference, title, primary_category, report_count, independent_source_count, last_reported_at, is_synthetic
      from public.incident_clusters where status = 'active' and (${includeSynthetic} or not is_synthetic)
      order by last_reported_at desc nulls last limit 6`;
    const priority = await tx`
      select id, reference, title, category, severity, confidence, verification_status, investigation_status,
             priority_escalated, location_text, occurred_at, is_synthetic
      from public.reports_public
      where lifecycle_status = 'active' and (severity in ('HIGH','CRITICAL') or priority_escalated) and ${syn}
      order by priority_escalated desc, case severity when 'CRITICAL' then 0 when 'HIGH' then 1 else 2 end, occurred_at desc limit 6`;
    return { counts, clusters, byCategory, bySeverity, activity, hotspots, activeClusters, priority, generatedAt: new Date().toISOString() };
  });
}

export async function getAnalytics(actor: Actor) {
  return withActor(actor, async (tx) => {
    const byCategoryStatus = await tx`
      select category, verification_status, count(*)::int as count from public.reports_public group by 1, 2`;
    const severityConfidence = await tx`
      select id, reference, severity, confidence, category from public.reports_public
      where severity is not null and confidence is not null order by occurred_at desc limit 300`;
    const investigationOutcomes = await tx`
      select status, count(*)::int as count from public.investigations_public group by status`;
    const agentPerformance = await tx`
      select agent, status, count(*)::int as count, round(avg(duration_ms))::int as avg_ms
      from public.agent_findings_public group by agent, status`;
    const hourly = await tx`
      select extract(hour from occurred_at at time zone 'utc')::int as hour, count(*)::int as count
      from public.reports_public group by 1 order by 1`;
    const evidence = await tx`
      select coalesce(ai_relevance, 'not_analyzed') as relevance, count(*)::int as count,
             count(*) filter (where is_duplicate)::int as duplicates
      from public.evidence_public group by 1`;
    const clusterSizes = await tx`
      select report_count, independent_source_count, reference, title from public.incident_clusters
      where status = 'active' order by report_count desc limit 20`;
    const reviewThroughput = isStaff(actor)
      ? await tx`select decision, count(*)::int as count from public.human_reviews group by decision order by count desc`
      : [];
    return { byCategoryStatus, severityConfidence, investigationOutcomes, agentPerformance, hourly, evidence, clusterSizes, reviewThroughput };
  });
}

export async function getEvents(actor: Actor, opts: { afterId?: number; limit?: number; reportId?: string } = {}) {
  return withActor(actor, async (tx) => {
    const limit = Math.min(opts.limit ?? 40, 200);
    return tx`
      select e.id, e.event_type, e.report_id, e.cluster_id, e.investigation_id, e.actor_type, e.summary, e.visibility, e.created_at,
             r.reference as report_reference, r.is_synthetic as report_is_synthetic, c.reference as cluster_reference
      from public.incident_events e
      left join public.reports_public r on r.id = e.report_id
      left join public.incident_clusters c on c.id = e.cluster_id
      where e.id > ${opts.afterId ?? 0} ${opts.reportId ? tx`and e.report_id = ${opts.reportId}` : tx``}
      order by e.id desc limit ${limit}`;
  });
}

export async function getMapData(actor: Actor) {
  return withActor(actor, async (tx) => {
    const reports = await tx`
      select id, reference, title, category, latitude, longitude, location_precision, location_text, severity, confidence,
             verification_status, investigation_status, lifecycle_status, occurred_at, cluster_id, is_synthetic, priority_escalated
      from public.reports_public where latitude is not null`;
    const clusters = await tx`
      select id, reference, title, primary_category, report_count, independent_source_count, radius_m, is_synthetic,
             st_y(centroid::geometry) as latitude, st_x(centroid::geometry) as longitude, first_reported_at, last_reported_at
      from public.incident_clusters where status = 'active' and centroid is not null`;
    return { reports, clusters };
  });
}

export async function getInvestigations(actor: Actor) {
  return withActor(actor, async (tx) => {
    const view = isStaff(actor) ? tx`public.investigations` : tx`public.investigations_public`;
    const fview = isStaff(actor) ? tx`public.agent_findings` : tx`public.agent_findings_public`;
    return tx`
      select i.id, i.report_id, i.status, i.trigger, i.attempt, i.model, i.severity, i.confidence, i.needs_human_review,
             i.started_at, i.completed_at, i.created_at, r.reference, r.title, r.category, r.is_synthetic,
             (select json_agg(json_build_object('agent', f.agent, 'status', f.status, 'duration_ms', f.duration_ms) order by f.agent)
                from ${fview} f where f.investigation_id = i.id) as agents
      from ${view} i join public.reports_public r on r.id = i.report_id
      order by i.created_at desc limit 200`;
  });
}

export async function getClusters(actor: Actor) {
  return withActor(actor, async (tx) => tx`
    select c.id, c.reference, c.title, c.primary_category, c.report_count, c.independent_source_count, c.radius_m,
           c.first_reported_at, c.last_reported_at, c.explanation, c.scoring, c.status, c.is_synthetic,
           st_y(c.centroid::geometry) as latitude, st_x(c.centroid::geometry) as longitude
    from public.incident_clusters c where c.status = 'active' order by c.last_reported_at desc nulls last`);
}

/**
 * Intelligence graph: reports, clusters, evidence, places and time periods as
 * nodes; scored, explained relationships as edges.
 */
export async function getGraph(actor: Actor, opts: { clusterId?: string } = {}) {
  return withActor(actor, async (tx) => {
    const reports = await tx<{ id: string; reference: string; title: string; category: string; location_text: string; occurred_at: Date; severity: string | null; verification_status: string; cluster_id: string | null; is_synthetic: boolean; evidence_count: number }[]>`
      select id, reference, title, category, location_text, occurred_at, severity, verification_status, cluster_id, is_synthetic, evidence_count
      from public.reports_public
      where ${opts.clusterId ? tx`cluster_id = ${opts.clusterId}` : tx`cluster_id is not null or id in (
        select report_a from public.report_relationships union select report_b from public.report_relationships)`}
      order by occurred_at desc limit 250`;
    const ids = reports.map((r) => r.id);
    const relationships = ids.length
      ? await tx`select id, report_a, report_b, relationship_type, score, explanation, source, status, distance_m, time_delta_minutes, components
                 from public.report_relationships where report_a in ${tx(ids)} and report_b in ${tx(ids)}`
      : [];
    const clusterIds = [...new Set(reports.map((r) => r.cluster_id).filter(Boolean))] as string[];
    const clusters = clusterIds.length
      ? await tx`select id, reference, title, primary_category, report_count, independent_source_count, explanation, is_synthetic
                 from public.incident_clusters where id in ${tx(clusterIds)}`
      : [];
    const evidence = ids.length
      ? await tx`select id, report_id, file_kind, ai_relevance, is_duplicate, duplicate_kind from public.evidence_public where report_id in ${tx(ids)}`
      : [];
    const findings = ids.length
      ? await tx`select i.id, i.report_id, i.status, i.severity, i.confidence from public.investigations_public i
                 where i.report_id in ${tx(ids)} and i.status in ('completed','partial')
                 and i.created_at = (select max(created_at) from public.investigations_public j where j.report_id = i.report_id)`
      : [];
    return { reports, relationships, clusters, evidence, findings };
  });
}

export async function getNotifications(actor: Actor) {
  if (actor.kind !== "user") return [];
  return withActor(actor, (tx) => tx`
    select id, kind, title, body, report_id, read_at, created_at from public.notifications order by created_at desc limit 50`);
}

export async function getReviewQueue(actor: Actor) {
  return withActor(actor, (tx) => tx`
    select r.id, r.reference, r.title, r.category, r.severity, r.confidence, r.verification_status, r.investigation_status,
           r.priority_escalated, r.location_text, r.occurred_at, r.submitted_at, r.is_anonymous, r.is_synthetic, r.is_sensitive,
           (select count(*) from public.evidence e where e.report_id = r.id)::int as evidence_count,
           (select summary -> 'review_reasons' from public.investigations i where i.report_id = r.id order by created_at desc limit 1) as review_reasons
    from public.reports r
    where r.lifecycle_status = 'active' and r.verification_status not in ('verified','rejected')
    order by r.priority_escalated desc, r.needs_human_review desc,
             case r.severity when 'CRITICAL' then 0 when 'HIGH' then 1 when 'MODERATE' then 2 when 'LOW' then 3 else 4 end,
             r.submitted_at desc
    limit 200`);
}

export async function getAuditLog(actor: Actor) {
  return withActor(actor, (tx) => tx`
    select a.id, a.actor_role, a.action, a.entity_type, a.entity_id, a.previous_state, a.new_state, a.explanation, a.created_at,
           p.display_name as actor_name
    from public.audit_logs a left join public.profiles p on p.id = a.actor_id
    order by a.id desc limit 200`);
}

export async function getEvidenceList(actor: Actor) {
  return withActor(actor, (tx) => tx`
    select e.id, e.report_id, e.original_filename, e.mime_type, e.file_kind, e.size_bytes, e.sha256, e.phash, e.width, e.height,
           e.metadata, e.metadata_flags, e.ai_relevance, e.ai_analysis -> 'visible_summary' as visible_summary,
           e.duplicate_of, e.duplicate_kind, e.duplicate_distance, e.review_status, e.uploaded_at,
           r.reference, r.title, r.is_synthetic, r.is_sensitive
    from public.evidence e join public.reports r on r.id = e.report_id
    order by e.uploaded_at desc limit 300`);
}
