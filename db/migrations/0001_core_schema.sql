-- GOS-IP core schema
-- PostgreSQL 15+ with PostGIS (Supabase-compatible).
--
-- Access model
--   * The server connects with an owner role (DATABASE_URL). Owner connections
--     bypass RLS and are used ONLY by trusted system code (investigation
--     pipeline, correlation engine, migrations, seeding).
--   * Every user-initiated request runs inside a transaction that switches to
--     a restricted role (gosip_anon or gosip_user) and sets app.user_id. Row
--     level security policies below are therefore enforced by PostgreSQL for
--     all user-facing reads and writes, independent of the frontend.

create extension if not exists postgis;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'gosip_anon') then
    create role gosip_anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'gosip_user') then
    create role gosip_user nologin;
  end if;
end $$;

-- The connecting owner must be able to SET ROLE into the restricted roles.
do $$
begin
  execute format('grant gosip_anon to %I', current_user);
  execute format('grant gosip_user to %I', current_user);
end $$;

create schema if not exists app;
grant usage on schema app to gosip_anon, gosip_user;
grant usage on schema public to gosip_anon, gosip_user;

-- ---------------------------------------------------------------------------
-- Shared vocabulary
-- ---------------------------------------------------------------------------
create or replace function app.categories() returns text[]
language sql immutable as $$
  select array[
    'flooding','fire','road_accident','infrastructure_failure',
    'violence_security','medical_emergency','natural_disaster',
    'environmental','public_safety','other'
  ]
$$;

-- ---------------------------------------------------------------------------
-- Profiles & credentials
-- ---------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique check (email = lower(email) and position('@' in email) > 1),
  display_name  text not null check (char_length(display_name) between 1 and 80),
  role          text not null default 'reporter' check (role in ('reporter','analyst','admin')),
  organization  text,
  is_demo_account boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_login_at timestamptz
);

-- Password hashes live in a separate table that restricted roles can never read.
create table public.credentials (
  profile_id    uuid primary key references public.profiles(id) on delete cascade,
  password_hash text not null,
  updated_at    timestamptz not null default now()
);

create or replace function app.current_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- Role is resolved from the database, never trusted from the client.
create or replace function app.current_app_role() returns text
language sql stable security definer set search_path = public, app as $$
  select coalesce(
    (select role from public.profiles where id = app.current_user_id()),
    'anonymous'
  )
$$;

create or replace function app.is_staff() returns boolean
language sql stable as $$
  select app.current_app_role() in ('analyst','admin')
$$;

create or replace function app.is_admin() returns boolean
language sql stable as $$
  select app.current_app_role() = 'admin'
$$;

grant execute on all functions in schema app to gosip_anon, gosip_user;

-- ---------------------------------------------------------------------------
-- Incident clusters (defined before reports reference them through joins)
-- ---------------------------------------------------------------------------
create table public.incident_clusters (
  id                        uuid primary key default gen_random_uuid(),
  reference                 text not null unique,
  title                     text not null,
  primary_category          text not null check (primary_category = any (app.categories())),
  centroid                  geography(Point, 4326),
  radius_m                  numeric not null default 0,
  first_reported_at         timestamptz,
  last_reported_at          timestamptz,
  report_count              integer not null default 0,
  independent_source_count  integer not null default 0,
  status                    text not null default 'active' check (status in ('active','resolved','dismissed')),
  explanation               text not null default '',
  scoring                   jsonb not null default '{}'::jsonb,
  is_synthetic              boolean not null default false,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index incident_clusters_centroid_idx on public.incident_clusters using gist (centroid);
create index incident_clusters_status_idx on public.incident_clusters (status);

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------
create table public.reports (
  id                    uuid primary key default gen_random_uuid(),
  reference             text not null unique,
  title                 text not null check (char_length(title) between 5 and 200),
  description           text not null check (char_length(description) between 20 and 5000),
  category              text not null check (category = any (app.categories())),
  location_text         text not null check (char_length(location_text) between 2 and 300),
  location              geography(Point, 4326),
  location_source       text not null default 'none' check (location_source in ('map','gps','manual','none')),
  location_accuracy_m   numeric check (location_accuracy_m is null or location_accuracy_m >= 0),
  occurred_at           timestamptz not null,
  submitted_at          timestamptz not null default now(),
  reporter_id           uuid references public.profiles(id) on delete set null,
  is_anonymous          boolean not null default false,
  contact_name          text,
  contact_phone         text,
  contact_email         text,
  submitter_fingerprint text,
  is_synthetic          boolean not null default false,
  is_sensitive          boolean not null default false,
  verification_status   text not null default 'unverified'
                        check (verification_status in ('unverified','corroborated','verified','disputed','rejected')),
  lifecycle_status      text not null default 'active' check (lifecycle_status in ('active','resolved','archived')),
  investigation_status  text not null default 'pending'
                        check (investigation_status in ('pending','queued','running','completed','partial','failed','not_configured')),
  severity              text check (severity in ('LOW','MODERATE','HIGH','CRITICAL')),
  confidence            numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  priority_escalated    boolean not null default false,
  needs_human_review    boolean not null default false,
  public_visibility     text not null default 'standard' check (public_visibility in ('standard','restricted','hidden')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint anonymous_has_no_reporter check (not is_anonymous or reporter_id is null),
  constraint occurred_not_far_future check (occurred_at <= submitted_at + interval '1 hour')
);
create index reports_location_idx on public.reports using gist (location);
create index reports_occurred_idx on public.reports (occurred_at desc);
create index reports_category_idx on public.reports (category);
create index reports_status_idx on public.reports (verification_status, lifecycle_status);
create index reports_reporter_idx on public.reports (reporter_id);

-- ---------------------------------------------------------------------------
-- Evidence
-- ---------------------------------------------------------------------------
create table public.evidence (
  id                 uuid primary key default gen_random_uuid(),
  report_id          uuid not null references public.reports(id) on delete cascade,
  original_filename  text not null,
  mime_type          text not null,
  file_kind          text not null check (file_kind in ('image','video','other')),
  size_bytes         integer not null check (size_bytes > 0),
  storage_backend    text not null check (storage_backend in ('supabase','local')),
  storage_path       text not null,
  sha256             text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  phash              text check (phash is null or phash ~ '^[0-9a-f]{16}$'),
  width              integer,
  height             integer,
  metadata           jsonb not null default '{}'::jsonb,
  metadata_flags     text[] not null default '{}',
  exif_location      geography(Point, 4326),
  ai_analysis        jsonb,
  ai_relevance       text check (ai_relevance in ('relevant','partially_relevant','unrelated','inconclusive')),
  duplicate_of       uuid references public.evidence(id) on delete set null,
  duplicate_kind     text check (duplicate_kind in ('exact','near')),
  duplicate_distance integer,
  review_status      text not null default 'pending' check (review_status in ('pending','accepted','rejected','flagged')),
  uploaded_at        timestamptz not null default now()
);
create index evidence_report_idx on public.evidence (report_id);
create index evidence_sha_idx on public.evidence (sha256);
create index evidence_phash_idx on public.evidence (phash);

-- ---------------------------------------------------------------------------
-- Investigations & agent findings
-- ---------------------------------------------------------------------------
create table public.investigations (
  id                 uuid primary key default gen_random_uuid(),
  report_id          uuid not null references public.reports(id) on delete cascade,
  status             text not null default 'queued'
                     check (status in ('queued','running','completed','partial','failed','not_configured')),
  trigger            text not null default 'submission' check (trigger in ('submission','manual','retry','seed')),
  attempt            integer not null default 1,
  provider           text,
  model              text,
  summary            jsonb,
  severity           text check (severity in ('LOW','MODERATE','HIGH','CRITICAL')),
  confidence         numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  needs_human_review boolean not null default false,
  error              text,
  triggered_by       uuid references public.profiles(id) on delete set null,
  started_at         timestamptz,
  completed_at       timestamptz,
  created_at         timestamptz not null default now()
);
create index investigations_report_idx on public.investigations (report_id, created_at desc);
create index investigations_status_idx on public.investigations (status);

create table public.agent_findings (
  id               uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references public.investigations(id) on delete cascade,
  report_id        uuid not null references public.reports(id) on delete cascade,
  agent            text not null check (agent in ('classification','evidence','geospatial','corroboration','threat','lead')),
  status           text not null default 'pending'
                   check (status in ('pending','running','succeeded','failed','timed_out','skipped')),
  attempts         integer not null default 0,
  output           jsonb,
  deterministic    jsonb,
  error            text,
  input_refs       jsonb not null default '{}'::jsonb,
  provenance       text not null default 'ai_assessment' check (provenance in ('ai_assessment','deterministic','mixed')),
  model            text,
  tokens_in        integer,
  tokens_out       integer,
  started_at       timestamptz,
  completed_at     timestamptz,
  duration_ms      integer,
  created_at       timestamptz not null default now(),
  unique (investigation_id, agent)
);
create index agent_findings_report_idx on public.agent_findings (report_id);

-- ---------------------------------------------------------------------------
-- Relationships
-- ---------------------------------------------------------------------------
create table public.cluster_relationships (
  id               uuid primary key default gen_random_uuid(),
  cluster_id       uuid not null references public.incident_clusters(id) on delete cascade,
  report_id        uuid not null references public.reports(id) on delete cascade,
  status           text not null default 'active' check (status in ('active','removed')),
  membership_score numeric(4,3),
  explanation      text not null default '',
  source           text not null default 'engine' check (source in ('engine','human')),
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (cluster_id, report_id)
);
create unique index cluster_relationships_one_active
  on public.cluster_relationships (report_id) where status = 'active';

create table public.report_relationships (
  id                  uuid primary key default gen_random_uuid(),
  report_a            uuid not null references public.reports(id) on delete cascade,
  report_b            uuid not null references public.reports(id) on delete cascade,
  relationship_type   text not null check (relationship_type in ('related','corroborating','possible_duplicate','conflicting')),
  score               numeric(4,3) not null check (score >= 0 and score <= 1),
  components          jsonb not null default '{}'::jsonb,
  distance_m          numeric,
  time_delta_minutes  numeric,
  explanation         text not null,
  source              text not null default 'engine' check (source in ('engine','human')),
  status              text not null default 'active'
                      check (status in ('active','rejected_by_reviewer','confirmed_by_reviewer')),
  reviewed_by         uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint ordered_pair check (report_a < report_b),
  unique (report_a, report_b)
);
create index report_relationships_b_idx on public.report_relationships (report_b);

-- ---------------------------------------------------------------------------
-- Events, reviews, audit, notifications
-- ---------------------------------------------------------------------------
create table public.incident_events (
  id               bigint generated always as identity primary key,
  event_type       text not null,
  report_id        uuid references public.reports(id) on delete cascade,
  cluster_id       uuid references public.incident_clusters(id) on delete set null,
  investigation_id uuid references public.investigations(id) on delete set null,
  actor_type       text not null check (actor_type in ('system','agent','user','reviewer')),
  actor_id         uuid references public.profiles(id) on delete set null,
  summary          text not null,
  details          jsonb not null default '{}'::jsonb,
  visibility       text not null default 'public' check (visibility in ('public','staff')),
  created_at       timestamptz not null default now()
);
create index incident_events_created_idx on public.incident_events (created_at desc);
create index incident_events_report_idx on public.incident_events (report_id, created_at);

create table public.human_reviews (
  id             uuid primary key default gen_random_uuid(),
  report_id      uuid references public.reports(id) on delete cascade,
  cluster_id     uuid references public.incident_clusters(id) on delete set null,
  reviewer_id    uuid not null references public.profiles(id),
  decision       text not null check (decision in (
                   'verify','reject','dispute','escalate','deescalate','resolve','reopen','note',
                   'merge','separate','confirm_relationship','reject_relationship','accept_evidence','reject_evidence')),
  previous_state jsonb not null default '{}'::jsonb,
  new_state      jsonb not null default '{}'::jsonb,
  notes          text,
  created_at     timestamptz not null default now()
);
create index human_reviews_report_idx on public.human_reviews (report_id, created_at desc);

create table public.audit_logs (
  id             bigint generated always as identity primary key,
  actor_id       uuid references public.profiles(id) on delete set null,
  actor_role     text not null,
  action         text not null,
  entity_type    text not null,
  entity_id      text,
  previous_state jsonb,
  new_state      jsonb,
  explanation    text,
  created_at     timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

create or replace function app.audit_logs_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_logs is append-only';
end $$;
create trigger audit_logs_no_update before update or delete on public.audit_logs
  for each row execute function app.audit_logs_immutable();

create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid references public.profiles(id) on delete cascade,
  audience     text not null default 'staff' check (audience in ('staff','user')),
  kind         text not null,
  title        text not null,
  body         text not null default '',
  report_id    uuid references public.reports(id) on delete cascade,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------
create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles for each row execute function app.touch_updated_at();
create trigger reports_touch before update on public.reports for each row execute function app.touch_updated_at();
create trigger clusters_touch before update on public.incident_clusters for each row execute function app.touch_updated_at();
create trigger cluster_rel_touch before update on public.cluster_relationships for each row execute function app.touch_updated_at();
create trigger report_rel_touch before update on public.report_relationships for each row execute function app.touch_updated_at();

-- AI and system processes may never verify, resolve, or un-reject a report.
-- Only a transaction flagged as a human reviewer action may do so.
create or replace function app.guard_human_only_transitions() returns trigger
language plpgsql as $$
declare
  actor text := coalesce(current_setting('app.actor_type', true), '');
begin
  if actor <> 'reviewer' then
    if new.verification_status = 'verified' and old.verification_status is distinct from 'verified' then
      raise exception 'Only a human reviewer can mark a report as verified';
    end if;
    if new.lifecycle_status = 'resolved' and old.lifecycle_status is distinct from 'resolved' then
      raise exception 'Only a human reviewer can resolve an incident';
    end if;
    if old.verification_status in ('verified','rejected','disputed')
       and new.verification_status is distinct from old.verification_status then
      raise exception 'Human review decisions can only be changed by a human reviewer';
    end if;
  end if;
  return new;
end $$;
create trigger reports_guard_transitions before update on public.reports
  for each row execute function app.guard_human_only_transitions();

-- Sensitive categories default to restricted precision.
create or replace function app.mark_sensitive() returns trigger
language plpgsql as $$
begin
  if new.category = 'violence_security' then
    new.is_sensitive := true;
  end if;
  return new;
end $$;
create trigger reports_mark_sensitive before insert or update of category on public.reports
  for each row execute function app.mark_sensitive();

create or replace function app.new_reference(prefix text) returns text
language sql volatile as $$
  select prefix || '-' || to_char(now() at time zone 'utc', 'YYMMDD') || '-' ||
         upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6))
$$;
