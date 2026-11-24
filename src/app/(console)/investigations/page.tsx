"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Radar } from "lucide-react";
import { api, timeAgo } from "@/lib/client/utils";
import { AGENTS } from "@/lib/domain/constants";
import { PageHeader } from "@/components/app/shell";
import { AgentStatusDots } from "@/components/app/agent-pipeline";
import { EmptyState, ErrorState, Panel, Skeleton } from "@/components/ui/primitives";
import { CategoryTag, ConfidenceMeter, InvestigationBadge, SeverityBadge, SyntheticTag } from "@/components/ui/badges";

interface Row {
  id: string; report_id: string; status: string; trigger: string; attempt: number; model: string | null; severity: string | null; confidence: number | null;
  needs_human_review: boolean; started_at: string | null; completed_at: string | null; created_at: string; reference: string; title: string; category: string; is_synthetic: boolean;
  agents: { agent: string; status: string; duration_ms: number | null }[] | null;
}

export default function InvestigationsPage() {
  const q = useQuery({
    queryKey: ["investigations"],
    queryFn: () => api<{ items: Row[]; aiConfigured: boolean }>("/api/investigations"),
    refetchInterval: (query) => (query.state.data?.items.some((i) => i.status === "running" || i.status === "queued") ? 2500 : 10_000),
  });
  const running = q.data?.items.filter((i) => i.status === "running").length ?? 0;
  return (
    <div>
      <PageHeader
        title="Investigations"
        description={
          <>Each report is investigated by six specialised agents: {AGENTS.map((a) => `${a.code} ${a.name.replace(" Agent", "")}`).join(" · ")}. Failures are recorded, never hidden.</>
        }
        actions={running > 0 ? <span className="flex items-center gap-2 text-xs text-accent"><span className="size-2 animate-pulse rounded-full bg-accent" />{running} running</span> : undefined}
      />
      <div className="space-y-4 p-4 lg:p-6">
        {q.data && !q.data.aiConfigured && (
          <p className="rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-xs text-warn">
            The AI provider is not configured on this deployment (ANTHROPIC_API_KEY). New reports are recorded as “AI not configured” and routed to human review; no AI results are fabricated.
          </p>
        )}
        <Panel bodyClassName="p-0">
          {q.isLoading && <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>}
          {q.error && <div className="p-4"><ErrorState error={q.error} retry={() => q.refetch()} /></div>}
          {q.data?.items.length === 0 && <EmptyState icon={<Radar className="size-6" />} title="No investigations yet">Investigations start automatically when a report is submitted.</EmptyState>}
          {q.data && q.data.items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-[13px]">
                <thead className="border-b border-line text-[10.5px] uppercase tracking-[0.1em] text-dim">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Report</th>
                    <th className="px-2 py-2 font-semibold">Status</th>
                    <th className="px-2 py-2 font-semibold">Agents A–F</th>
                    <th className="px-2 py-2 font-semibold">Severity</th>
                    <th className="px-2 py-2 font-semibold">Confidence</th>
                    <th className="px-2 py-2 font-semibold">Review</th>
                    <th className="px-4 py-2 text-right font-semibold">Started</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {q.data.items.map((i) => (
                    <tr key={i.id} className="hover:bg-panel-2">
                      <td className="px-4 py-2.5">
                        <Link href={`/investigations/${i.id}`} className="block">
                          <span className="flex items-center gap-2"><span className="font-mono text-[11px] text-accent">{i.reference}</span><CategoryTag category={i.category} />{i.is_synthetic && <SyntheticTag />}</span>
                          <span className="mt-0.5 block max-w-md truncate">{i.title}</span>
                          <span className="text-[10.5px] text-dim">attempt {i.attempt} · {i.trigger}{i.model ? ` · ${i.model}` : ""}</span>
                        </Link>
                      </td>
                      <td className="px-2"><InvestigationBadge status={i.status} /></td>
                      <td className="px-2"><AgentStatusDots agents={i.agents} /></td>
                      <td className="px-2"><SeverityBadge severity={i.severity} /></td>
                      <td className="px-2"><ConfidenceMeter value={i.confidence} /></td>
                      <td className="px-2 text-xs">{i.needs_human_review ? <span className="text-warn">Requested</span> : <span className="text-dim">—</span>}</td>
                      <td className="px-4 text-right text-xs text-muted">{timeAgo(i.started_at ?? i.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
