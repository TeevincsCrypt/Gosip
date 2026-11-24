-- GOS-IP row level security, grants and public views.

alter table public.profiles              enable row level security;
alter table public.credentials           enable row level security;
alter table public.reports               enable row level security;
alter table public.evidence              enable row level security;
alter table public.investigations        enable row level security;
alter table public.agent_findings        enable row level security;
alter table public.incident_clusters     enable row level security;
alter table public.cluster_relationships enable row level security;
alter table public.report_relationships  enable row level security;
alter table public.incident_events       enable row level security;
alter table public.human_reviews         enable row level security;
alter table public.audit_logs            enable row level security;
alter table public.notifications         enable row level security;

-- credentials: no grants, no policies -> unreadable by restricted roles.
revoke all on public.credentials from gosip_anon, gosip_user;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
grant select on public.profiles to gosip_user;
grant update (display_name, organization) on public.profiles to gosip_user;
grant update (role) on public.profiles to gosip_user;  -- constrained by policy below

create policy profiles_select_self_or_staff on public.profiles for select to gosip_user
  using (id = app.current_user_id() or app.is_staff());
create policy profiles_update_self on public.profiles for update to gosip_user
  using (id = app.current_user_id() or app.is_admin())
  with check (
    app.is_admin()
    or (id = app.current_user_id() and role = (select p.role from public.profiles p where p.id = app.current_user_id()))
  );

-- ---------------------------------------------------------------------------
-- reports
-- ---------------------------------------------------------------------------
grant insert on public.reports to gosip_anon;
grant select, insert on public.reports to gosip_user;
grant update (verification_status, lifecycle_status, severity, priority_escalated,
              needs_human_review, public_visibility, investigation_status)
  on public.reports to gosip_user;

-- Insert: anyone may submit, but only as an unverified, pending report and only
-- on their own behalf. Anonymous submissions carry no reporter id.
create policy reports_insert on public.reports for insert to gosip_anon, gosip_user
  with check (
    verification_status = 'unverified'
    and lifecycle_status = 'active'
    and investigation_status in ('pending','queued','not_configured')
    and severity is null and confidence is null
    and needs_human_review = false and priority_escalated = false
    and public_visibility = 'standard'
    and is_synthetic = false
    and (
      (is_anonymous and reporter_id is null)
      or (not is_anonymous and reporter_id is not distinct from app.current_user_id())
    )
  );

-- Full rows (including contact details) are visible to the reporter and staff only.
create policy reports_select_own_or_staff on public.reports for select to gosip_user
  using (reporter_id = app.current_user_id() or app.is_staff());

create policy reports_update_staff on public.reports for update to gosip_user
  using (app.is_staff()) with check (app.is_staff());

-- Public, redacted projection. Owned by the migration role so it reads the base
-- table, but it never exposes contact details, reporter identity or fingerprints,
-- and it coarsens coordinates for sensitive reports (~1.1 km grid).
create view public.reports_public with (security_barrier = true) as
select
  r.id, r.reference, r.title, r.description, r.category, r.location_text,
  case when r.location is null then null
       when r.is_sensitive or r.public_visibility = 'restricted'
         then round(st_y(r.location::geometry)::numeric, 2)
       else round(st_y(r.location::geometry)::numeric, 5) end as latitude,
  case when r.location is null then null
       when r.is_sensitive or r.public_visibility = 'restricted'
         then round(st_x(r.location::geometry)::numeric, 2)
       else round(st_x(r.location::geometry)::numeric, 5) end as longitude,
  case when r.location is null then 'none'
       when r.is_sensitive or r.public_visibility = 'restricted' then 'approximate'
       else 'precise' end as location_precision,
  r.location_source, r.occurred_at, r.submitted_at, r.is_anonymous,
  (r.reporter_id is not null) as is_registered_reporter,
  r.is_synthetic, r.is_sensitive, r.verification_status, r.lifecycle_status,
  r.investigation_status, r.severity, r.confidence, r.priority_escalated,
  r.needs_human_review, r.created_at, r.updated_at,
  (select cr.cluster_id from public.cluster_relationships cr
    where cr.report_id = r.id and cr.status = 'active' limit 1) as cluster_id,
  (select count(*) from public.evidence e where e.report_id = r.id)::int as evidence_count
from public.reports r
where r.public_visibility <> 'hidden' and r.verification_status <> 'rejected';

grant select on public.reports_public to gosip_anon, gosip_user;

-- ---------------------------------------------------------------------------
-- evidence
-- ---------------------------------------------------------------------------
grant insert on public.evidence to gosip_anon, gosip_user;
grant select on public.evidence to gosip_user;
grant update (review_status) on public.evidence to gosip_user;

create or replace function app.report_accepts_evidence(rid uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from public.reports r
    where r.id = rid and r.submitted_at > now() - interval '15 minutes'
  )
$$;
grant execute on function app.report_accepts_evidence(uuid) to gosip_anon, gosip_user;

-- Evidence may only be attached to a report created in the last 15 minutes
-- (the submission window); the API performs the actual upload.
create policy evidence_insert_recent_report on public.evidence for insert to gosip_anon, gosip_user
  with check (
    ai_analysis is null and ai_relevance is null and review_status = 'pending'
    and app.report_accepts_evidence(report_id)
  );
create policy evidence_select_staff on public.evidence for select to gosip_user
  using (app.is_staff());
create policy evidence_update_staff on public.evidence for update to gosip_user
  using (app.is_staff()) with check (app.is_staff());

-- Public evidence projection: no file paths, no EXIF location, no raw metadata.
create view public.evidence_public with (security_barrier = true) as
select
  e.id, e.report_id, e.file_kind, e.mime_type, e.uploaded_at, e.ai_relevance,
  (e.duplicate_of is not null) as is_duplicate, e.duplicate_kind,
  e.metadata_flags, e.review_status,
  case when r.is_sensitive then null else e.ai_analysis -> 'visible_summary' end as visible_summary
from public.evidence e
join public.reports r on r.id = e.report_id
where r.public_visibility <> 'hidden' and r.verification_status <> 'rejected';

grant select on public.evidence_public to gosip_anon, gosip_user;

-- ---------------------------------------------------------------------------
-- investigations & findings
-- ---------------------------------------------------------------------------
grant select on public.investigations, public.agent_findings to gosip_user;
create policy investigations_select_staff on public.investigations for select to gosip_user
  using (app.is_staff());
create policy agent_findings_select_staff on public.agent_findings for select to gosip_user
  using (app.is_staff());

-- Public investigation projection. Findings for sensitive reports are withheld.
create view public.investigations_public with (security_barrier = true) as
select
  i.id, i.report_id, i.status, i.trigger, i.attempt, i.provider, i.model,
  case when r.is_sensitive then null else i.summary end as summary,
  i.severity, i.confidence, i.needs_human_review, i.error is not null as has_error,
  i.started_at, i.completed_at, i.created_at, r.is_sensitive
from public.investigations i
join public.reports r on r.id = i.report_id
where r.public_visibility <> 'hidden' and r.verification_status <> 'rejected';

create view public.agent_findings_public with (security_barrier = true) as
select
  f.id, f.investigation_id, f.report_id, f.agent, f.status, f.attempts,
  case when r.is_sensitive then null else f.output end as output,
  case when r.is_sensitive then null else f.deterministic end as deterministic,
  case when f.error is null then null else 'Agent did not complete' end as error_summary,
  f.input_refs, f.provenance, f.model, f.started_at, f.completed_at, f.duration_ms
from public.agent_findings f
join public.reports r on r.id = f.report_id
where r.public_visibility <> 'hidden' and r.verification_status <> 'rejected';

grant select on public.investigations_public, public.agent_findings_public to gosip_anon, gosip_user;

-- ---------------------------------------------------------------------------
-- clusters & relationships (aggregate intelligence is public; membership of
-- hidden/rejected reports is filtered out)
-- ---------------------------------------------------------------------------
grant select on public.incident_clusters, public.cluster_relationships, public.report_relationships
  to gosip_anon, gosip_user;
grant update (status) on public.incident_clusters to gosip_user;
grant insert, update (status, source, created_by, explanation) on public.cluster_relationships to gosip_user;
grant update (status, reviewed_by) on public.report_relationships to gosip_user;
grant insert on public.report_relationships to gosip_user;

create policy clusters_select_all on public.incident_clusters for select to gosip_anon, gosip_user
  using (status <> 'dismissed' or app.is_staff());
create policy clusters_update_staff on public.incident_clusters for update to gosip_user
  using (app.is_staff()) with check (app.is_staff());

create policy cluster_rel_select on public.cluster_relationships for select to gosip_anon, gosip_user
  using (app.is_staff() or exists (select 1 from public.reports_public rp where rp.id = report_id));
create policy cluster_rel_write_staff on public.cluster_relationships for insert to gosip_user
  with check (app.is_staff() and source = 'human');
create policy cluster_rel_update_staff on public.cluster_relationships for update to gosip_user
  using (app.is_staff()) with check (app.is_staff());

create policy report_rel_select on public.report_relationships for select to gosip_anon, gosip_user
  using (
    app.is_staff() or (
      exists (select 1 from public.reports_public rp where rp.id = report_a)
      and exists (select 1 from public.reports_public rp where rp.id = report_b)
    )
  );
create policy report_rel_update_staff on public.report_relationships for update to gosip_user
  using (app.is_staff()) with check (app.is_staff());
create policy report_rel_insert_staff on public.report_relationships for insert to gosip_user
  with check (app.is_staff() and source = 'human' and reviewed_by = app.current_user_id());

-- ---------------------------------------------------------------------------
-- events / reviews / audit / notifications
-- ---------------------------------------------------------------------------
grant select on public.incident_events to gosip_anon, gosip_user;
grant insert on public.incident_events to gosip_user;
create policy events_select on public.incident_events for select to gosip_anon, gosip_user
  using (
    (visibility = 'public' and (report_id is null or exists (select 1 from public.reports_public rp where rp.id = report_id)))
    or app.is_staff()
  );
create policy events_insert_staff on public.incident_events for insert to gosip_user
  with check (app.is_staff() and actor_type = 'reviewer' and actor_id = app.current_user_id());

grant select, insert on public.human_reviews to gosip_user;
create policy reviews_select_staff on public.human_reviews for select to gosip_user using (app.is_staff());
create policy reviews_insert_staff on public.human_reviews for insert to gosip_user
  with check (app.is_staff() and reviewer_id = app.current_user_id());

grant select, insert on public.audit_logs to gosip_user;
create policy audit_select_admin on public.audit_logs for select to gosip_user using (app.is_staff());
create policy audit_insert_self on public.audit_logs for insert to gosip_user
  with check (actor_id = app.current_user_id());

grant select on public.notifications to gosip_user;
grant update (read_at) on public.notifications to gosip_user;
create policy notifications_select on public.notifications for select to gosip_user
  using (recipient_id = app.current_user_id() or (recipient_id is null and audience = 'staff' and app.is_staff()));
create policy notifications_update on public.notifications for update to gosip_user
  using (recipient_id = app.current_user_id() or (recipient_id is null and app.is_staff()));

-- Identity sequences for inserts by restricted roles.
grant usage on all sequences in schema public to gosip_user;

-- Supabase Realtime: when running on Supabase, expose only event ids/types of
-- public events to the anon role so clients can refresh promptly. Clients still
-- fetch data through the authorised API. No-op on plain PostgreSQL.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant select (id, event_type, visibility, created_at) on public.incident_events to anon';
    execute $p$create policy events_realtime_anon on public.incident_events for select to anon using (visibility = 'public')$p$;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.incident_events';
  end if;
end $$;
