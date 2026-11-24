"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, Bot, CheckCircle2, FileImage, FilePlus2, GitMerge, Link2, Radar, ShieldAlert, ShieldCheck, Waypoints, XCircle,
} from "lucide-react";
import { api, cn, timeAgo } from "@/lib/client/utils";
import type { EventRow } from "@/lib/domain/types";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/primitives";

const ICONS: Record<string, { icon: typeof Bot; tone: string }> = {
  report_submitted: { icon: FilePlus2, tone: "text-fg" },
  evidence_uploaded: { icon: FileImage, tone: "text-muted" },
  investigation_started: { icon: Radar, tone: "text-accent" },
  agent_completed: { icon: Bot, tone: "text-accent/80" },
  agent_failed: { icon: XCircle, tone: "text-danger" },
  evidence_analyzed: { icon: FileImage, tone: "text-info" },
  duplicate_evidence_detected: { icon: AlertTriangle, tone: "text-warn" },
  related_report_discovered: { icon: Link2, tone: "text-info" },
  cluster_created: { icon: Waypoints, tone: "text-accent" },
  cluster_updated: { icon: Waypoints, tone: "text-accent/80" },
  severity_assessed: { icon: ShieldAlert, tone: "text-warn" },
  human_review_requested: { icon: AlertTriangle, tone: "text-warn" },
  investigation_completed: { icon: CheckCircle2, tone: "text-accent" },
  investigation_partial: { icon: AlertTriangle, tone: "text-warn" },
  investigation_failed: { icon: XCircle, tone: "text-danger" },
  investigation_not_configured: { icon: AlertTriangle, tone: "text-dim" },
  report_verified: { icon: ShieldCheck, tone: "text-accent" },
  incident_resolved: { icon: CheckCircle2, tone: "text-accent" },
  reports_merged: { icon: GitMerge, tone: "text-info" },
};

export function LiveFeed({ limit = 30, compact }: { limit?: number; compact?: boolean }) {
  const q = useQuery({
    queryKey: ["events", limit],
    queryFn: () => api<{ items: EventRow[] }>(`/api/events?limit=${limit}`),
  });
  if (q.isLoading) return <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (!q.data?.items.length) return <EmptyState title="No activity yet">System events appear here as reports are submitted and investigated.</EmptyState>;
  return (
    <ol className="relative space-y-0" aria-live="polite">
      {q.data.items.map((e) => {
        const meta = ICONS[e.event_type] ?? { icon: Bot, tone: "text-muted" };
        const Icon = meta.icon;
        const body = (
          <div className={cn("flex gap-2.5 border-b border-line/60 py-2", compact ? "text-[12px]" : "text-[13px]")}>
            <Icon className={cn("mt-0.5 size-3.5 shrink-0", meta.tone)} />
            <div className="min-w-0 flex-1">
              <p className="leading-snug text-fg/90">{e.summary}</p>
              <p className="mt-0.5 flex items-center gap-2 text-[10.5px] text-dim">
                <span>{timeAgo(e.created_at)}</span>
                <span className="uppercase tracking-wider">{e.actor_type}</span>
                {e.visibility === "staff" && <span className="text-warn/80">staff only</span>}
              </p>
            </div>
          </div>
        );
        return (
          <li key={e.id}>
            {e.report_id ? (
              <Link href={`/reports/${e.report_id}`} className="block hover:bg-panel-2/50">
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ol>
  );
}
