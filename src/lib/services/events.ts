import "server-only";
import type { Tx } from "@/lib/db/context";

export type EventType =
  | "report_submitted"
  | "evidence_uploaded"
  | "investigation_started"
  | "investigation_not_configured"
  | "agent_completed"
  | "agent_failed"
  | "evidence_analyzed"
  | "duplicate_evidence_detected"
  | "related_report_discovered"
  | "cluster_created"
  | "cluster_updated"
  | "severity_assessed"
  | "human_review_requested"
  | "investigation_completed"
  | "investigation_partial"
  | "investigation_failed"
  | "report_verified"
  | "report_rejected"
  | "report_disputed"
  | "report_escalated"
  | "report_deescalated"
  | "incident_resolved"
  | "incident_reopened"
  | "reviewer_note_added"
  | "reports_merged"
  | "report_separated"
  | "relationship_reviewed"
  | "evidence_reviewed"
  | "corroboration_status_changed";

export interface EventInput {
  type: EventType;
  summary: string;
  actorType: "system" | "agent" | "user" | "reviewer";
  actorId?: string | null;
  reportId?: string | null;
  clusterId?: string | null;
  investigationId?: string | null;
  details?: Record<string, unknown>;
  visibility?: "public" | "staff";
}

export async function recordEvent(tx: Tx, e: EventInput): Promise<void> {
  await tx`
    insert into public.incident_events
      (event_type, report_id, cluster_id, investigation_id, actor_type, actor_id, summary, details, visibility)
    values (${e.type}, ${e.reportId ?? null}, ${e.clusterId ?? null}, ${e.investigationId ?? null},
            ${e.actorType}, ${e.actorId ?? null}, ${e.summary}, ${tx.json((e.details ?? {}) as never)},
            ${e.visibility ?? "public"})`;
}

export async function notifyStaff(
  tx: Tx,
  n: { kind: string; title: string; body?: string; reportId?: string | null },
): Promise<void> {
  await tx`
    insert into public.notifications (recipient_id, audience, kind, title, body, report_id)
    values (null, 'staff', ${n.kind}, ${n.title}, ${n.body ?? ""}, ${n.reportId ?? null})`;
}
