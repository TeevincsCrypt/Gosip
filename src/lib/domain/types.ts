import type { AgentId, Category, InvestigationStatus, LifecycleStatus, Severity, VerificationStatus } from "./constants";

/** Public report projection (matches the reports_public view). */
export interface PublicReport {
  id: string;
  reference: string;
  title: string;
  description: string;
  category: Category;
  location_text: string;
  latitude: number | null;
  longitude: number | null;
  location_precision: "precise" | "approximate" | "none";
  location_source: string;
  occurred_at: string;
  submitted_at: string;
  is_anonymous: boolean;
  is_registered_reporter: boolean;
  is_synthetic: boolean;
  is_sensitive: boolean;
  verification_status: VerificationStatus;
  lifecycle_status: LifecycleStatus;
  investigation_status: InvestigationStatus;
  severity: Severity | null;
  confidence: number | null;
  priority_escalated: boolean;
  needs_human_review: boolean;
  created_at: string;
  updated_at: string;
  cluster_id: string | null;
  evidence_count: number;
}

export interface StaffReportExtras {
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  reporter_id: string | null;
  exact_latitude: number | null;
  exact_longitude: number | null;
}

export interface EventRow {
  id: number;
  event_type: string;
  report_id: string | null;
  cluster_id: string | null;
  investigation_id: string | null;
  actor_type: "system" | "agent" | "user" | "reviewer";
  summary: string;
  details: Record<string, unknown>;
  visibility: "public" | "staff";
  created_at: string;
  report_reference?: string | null;
  report_is_synthetic?: boolean | null;
}

export interface AgentFindingRow {
  id: string;
  investigation_id: string;
  report_id: string;
  agent: AgentId;
  status: "pending" | "running" | "succeeded" | "failed" | "timed_out" | "skipped";
  attempts: number;
  output: Record<string, unknown> | null;
  deterministic: Record<string, unknown> | null;
  error?: string | null;
  error_summary?: string | null;
  input_refs: Record<string, unknown>;
  provenance: string;
  model: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
}

export interface InvestigationRow {
  id: string;
  report_id: string;
  status: InvestigationStatus;
  trigger: string;
  attempt: number;
  provider: string | null;
  model: string | null;
  summary: Record<string, unknown> | null;
  severity: Severity | null;
  confidence: number | null;
  needs_human_review: boolean;
  error?: string | null;
  has_error?: boolean;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface ClusterRow {
  id: string;
  reference: string;
  title: string;
  primary_category: Category;
  latitude: number | null;
  longitude: number | null;
  radius_m: number;
  first_reported_at: string | null;
  last_reported_at: string | null;
  report_count: number;
  independent_source_count: number;
  status: "active" | "resolved" | "dismissed";
  explanation: string;
  scoring: Record<string, unknown>;
  is_synthetic: boolean;
}

export interface RelationshipRow {
  id: string;
  report_a: string;
  report_b: string;
  relationship_type: "related" | "corroborating" | "possible_duplicate" | "conflicting";
  score: number;
  components: Record<string, number>;
  distance_m: number | null;
  time_delta_minutes: number | null;
  explanation: string;
  source: "engine" | "human";
  status: "active" | "rejected_by_reviewer" | "confirmed_by_reviewer";
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: "reporter" | "analyst" | "admin";
}
