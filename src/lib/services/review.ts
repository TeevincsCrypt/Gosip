import "server-only";
import { isStaff, withActor, withSystem, type Actor, type Tx } from "@/lib/db/context";
import type { ReviewAction } from "@/lib/domain/schemas";
import { recomputeClusters } from "./correlation";
import { recordEvent, type EventType } from "./events";

export class ReviewError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "ReviewError";
  }
}

const REPORT_STATE_COLUMNS = "verification_status, lifecycle_status, priority_escalated, needs_human_review, severity, public_visibility";

type ReportState = Record<string, unknown> & { reference: string };

async function reportState(tx: Tx, id: string): Promise<ReportState> {
  const [row] = await tx.unsafe<ReportState[]>(`select reference, ${REPORT_STATE_COLUMNS} from public.reports where id = $1`, [id]);
  if (!row) throw new ReviewError("Report not found", 404);
  return row;
}

/**
 * Apply a human reviewer decision. Runs as the reviewer's restricted database
 * role with the reviewer flag set, so RLS and the human-only transition guard
 * are both enforced by PostgreSQL. Every action writes a human_reviews row,
 * an audit_logs row and a timeline event.
 */
export async function applyReviewAction(actor: Actor, action: ReviewAction): Promise<{ ok: true; summary: string }> {
  if (actor.kind !== "user" || !isStaff(actor)) throw new ReviewError("Reviewer role required", 403);
  const reviewerId = actor.userId;
  let recluster = false;

  const summary = await withActor(
    actor,
    async (tx) => {
      const audit = async (entityType: string, entityId: string, prev: unknown, next: unknown) => {
        await tx`
          insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, previous_state, new_state, explanation)
          values (${reviewerId}, ${actor.role}, ${action.action}, ${entityType}, ${entityId},
                  ${tx.json((prev ?? {}) as never)}, ${tx.json((next ?? {}) as never)}, ${action.notes ?? null})`;
      };
      const review = async (reportId: string | null, prev: unknown, next: unknown, decision = action.action) => {
        await tx`
          insert into public.human_reviews (report_id, cluster_id, reviewer_id, decision, previous_state, new_state, notes)
          values (${reportId}, ${action.clusterId ?? null}, ${reviewerId}, ${decision},
                  ${tx.json((prev ?? {}) as never)}, ${tx.json((next ?? {}) as never)}, ${action.notes ?? null})`;
      };
      const event = async (type: EventType, text: string, reportId: string | null, visibility: "public" | "staff" = "public") => {
        await recordEvent(tx, { type, actorType: "reviewer", actorId: reviewerId, reportId, clusterId: action.clusterId ?? null, summary: text, visibility });
      };

      const reportStatusChange = async (
        patch: Record<string, unknown>,
        type: EventType,
        describe: (ref: string) => string,
      ) => {
        if (!action.reportId) throw new ReviewError("reportId is required");
        const prev = await reportState(tx, action.reportId);
        const keys = Object.keys(patch);
        await tx`update public.reports set ${tx(patch, ...keys)} where id = ${action.reportId}`;
        const next = await reportState(tx, action.reportId);
        await review(action.reportId, prev, next);
        await audit("report", action.reportId, prev, next);
        const text = describe(prev.reference);
        await event(type, text, action.reportId);
        return text;
      };

      switch (action.action) {
        case "verify":
          recluster = true;
          return reportStatusChange({ verification_status: "verified", needs_human_review: false }, "report_verified", (r) => `${r} verified by a human reviewer`);
        case "reject":
          recluster = true;
          return reportStatusChange({ verification_status: "rejected", needs_human_review: false }, "report_rejected", (r) => `${r} rejected by a human reviewer`);
        case "dispute":
          return reportStatusChange({ verification_status: "disputed" }, "report_disputed", (r) => `${r} marked disputed by a human reviewer`);
        case "escalate":
          return reportStatusChange({ priority_escalated: true }, "report_escalated", (r) => `${r} escalated for urgent response by a human reviewer`);
        case "deescalate":
          return reportStatusChange({ priority_escalated: false }, "report_deescalated", (r) => `${r} de-escalated by a human reviewer`);
        case "resolve":
          return reportStatusChange({ lifecycle_status: "resolved", needs_human_review: false }, "incident_resolved", (r) => `${r} marked resolved by a human reviewer`);
        case "reopen":
          return reportStatusChange({ lifecycle_status: "active" }, "incident_reopened", (r) => `${r} reopened by a human reviewer`);
        case "note": {
          if (!action.reportId || !action.notes) throw new ReviewError("reportId and notes are required");
          const state = await reportState(tx, action.reportId);
          await review(action.reportId, state, state);
          await audit("report", action.reportId, null, { note: action.notes });
          await event("reviewer_note_added", `Investigation note added to ${state.reference}`, action.reportId, "staff");
          return "Note added";
        }
        case "separate": {
          if (!action.reportId || !action.clusterId) throw new ReviewError("reportId and clusterId are required");
          const state = await reportState(tx, action.reportId);
          const rels = await tx<{ id: string }[]>`
            update public.report_relationships rr set status = 'rejected_by_reviewer', reviewed_by = ${reviewerId}
            where (rr.report_a = ${action.reportId} or rr.report_b = ${action.reportId})
              and rr.status <> 'rejected_by_reviewer'
              and exists (
                select 1 from public.cluster_relationships cr
                where cr.cluster_id = ${action.clusterId} and cr.status = 'active'
                  and cr.report_id = case when rr.report_a = ${action.reportId} then rr.report_b else rr.report_a end)
            returning rr.id`;
          await review(action.reportId, { cluster_id: action.clusterId }, { cluster_id: null, rejected_relationships: rels.map((r) => r.id) });
          await audit("cluster_membership", action.reportId, { cluster_id: action.clusterId }, { rejected_relationships: rels.map((r) => r.id) });
          await event("report_separated", `${state.reference} separated from cluster by a human reviewer (${rels.length} link(s) rejected)`, action.reportId);
          recluster = true;
          return `Separated ${state.reference} (${rels.length} relationship(s) rejected)`;
        }
        case "merge": {
          if (!action.reportId || !action.targetReportId || action.reportId === action.targetReportId) {
            throw new ReviewError("reportId and a different targetReportId are required");
          }
          const [a, b] = [action.reportId, action.targetReportId].sort();
          const sa = await reportState(tx, action.reportId);
          const sb = await reportState(tx, action.targetReportId);
          const explanation = `Linked by a human reviewer${action.notes ? `: ${action.notes}` : "."}`;
          const [existing] = await tx<{ id: string }[]>`select id from public.report_relationships where report_a = ${a} and report_b = ${b}`;
          if (existing) {
            await tx`update public.report_relationships set status = 'confirmed_by_reviewer', reviewed_by = ${reviewerId} where id = ${existing.id}`;
          } else {
            await tx`
              insert into public.report_relationships (report_a, report_b, relationship_type, score, components, explanation, source, status, reviewed_by)
              values (${a}, ${b}, 'related', 1, ${tx.json({ human: 1 } as never)}, ${explanation}, 'human', 'confirmed_by_reviewer', ${reviewerId})`;
          }
          await review(action.reportId, {}, { merged_with: action.targetReportId });
          await audit("report_relationship", `${a}:${b}`, null, { status: "confirmed_by_reviewer", source: existing ? "engine" : "human" });
          await event("reports_merged", `${sa.reference} and ${sb.reference} linked into the same incident by a human reviewer`, action.reportId);
          recluster = true;
          return `Linked ${sa.reference} with ${sb.reference}`;
        }
        case "confirm_relationship":
        case "reject_relationship": {
          if (!action.relationshipId) throw new ReviewError("relationshipId is required");
          const status = action.action === "confirm_relationship" ? "confirmed_by_reviewer" : "rejected_by_reviewer";
          const [prev] = await tx<{ status: string; report_a: string }[]>`select status, report_a from public.report_relationships where id = ${action.relationshipId}`;
          if (!prev) throw new ReviewError("Relationship not found", 404);
          await tx`update public.report_relationships set status = ${status}, reviewed_by = ${reviewerId} where id = ${action.relationshipId}`;
          await review(prev.report_a, { status: prev.status }, { status });
          await audit("report_relationship", action.relationshipId, { status: prev.status }, { status });
          await event("relationship_reviewed", `Relationship ${status === "confirmed_by_reviewer" ? "confirmed" : "rejected"} by a human reviewer`, prev.report_a);
          recluster = true;
          return "Relationship updated";
        }
        case "accept_evidence":
        case "reject_evidence": {
          if (!action.evidenceId) throw new ReviewError("evidenceId is required");
          const status = action.action === "accept_evidence" ? "accepted" : "rejected";
          const [prev] = await tx<{ review_status: string; report_id: string }[]>`select review_status, report_id from public.evidence where id = ${action.evidenceId}`;
          if (!prev) throw new ReviewError("Evidence not found", 404);
          await tx`update public.evidence set review_status = ${status} where id = ${action.evidenceId}`;
          await review(prev.report_id, { evidence_id: action.evidenceId, review_status: prev.review_status }, { evidence_id: action.evidenceId, review_status: status });
          await audit("evidence", action.evidenceId, { review_status: prev.review_status }, { review_status: status });
          await event("evidence_reviewed", `Evidence ${status} by a human reviewer`, prev.report_id, "staff");
          return `Evidence ${status}`;
        }
      }
    },
    { asReviewer: true },
  );

  if (recluster) await withSystem("system", (tx) => recomputeClusters(tx));
  return { ok: true, summary: summary ?? "Done" };
}
