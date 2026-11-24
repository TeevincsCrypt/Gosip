"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, History, ShieldAlert } from "lucide-react";
import { api, humanize, timeAgo } from "@/lib/client/utils";
import { PageHeader } from "@/components/app/shell";
import { RequireStaff } from "@/components/app/require-role";
import { Button, EmptyState, ErrorState, Panel, Skeleton } from "@/components/ui/primitives";

interface QueueItem { id: string; severity: string | null; priority_escalated: boolean; investigation_status: string; verification_status: string }
interface AuditRow { id: number; actor_name: string | null; actor_role: string; action: string; entity_type: string; entity_id: string | null; previous_state: Record<string, unknown> | null; new_state: Record<string, unknown> | null; explanation: string | null; created_at: string }

function diff(prev: Record<string, unknown> | null, next: Record<string, unknown> | null) {
  if (!prev || !next) return [];
  return Object.keys(next).filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k]) && k !== "reference").map((k) => `${humanize(k)}: ${String(prev[k] ?? "—")} → ${String(next[k] ?? "—")}`);
}

function AdminInner() {
  const queue = useQuery({ queryKey: ["queue"], queryFn: () => api<{ items: QueueItem[] }>("/api/admin/queue") });
  const audit = useQuery({ queryKey: ["audit"], queryFn: () => api<{ items: AuditRow[] }>("/api/admin/audit") });
  const items = queue.data?.items ?? [];
  const kpis = [
    { label: "Awaiting decision", value: items.length },
    { label: "Escalated", value: items.filter((i) => i.priority_escalated).length },
    { label: "HIGH / CRITICAL", value: items.filter((i) => i.severity === "HIGH" || i.severity === "CRITICAL").length },
    { label: "AI incomplete / failed", value: items.filter((i) => ["partial", "failed", "not_configured"].includes(i.investigation_status)).length },
  ];
  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-lg border border-line bg-panel px-4 py-3"><p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{k.label}</p><p className="mt-1 font-mono text-2xl">{queue.isLoading ? "…" : k.value}</p></div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href="/admin/review"><Button variant="primary"><ClipboardList className="size-4" /> Open review queue</Button></Link>
        <Link href="/investigations"><Button variant="outline"><ShieldAlert className="size-4" /> Monitor investigations</Button></Link>
      </div>
      <Panel title="Audit trail" subtitle="Append-only. Every human decision with actor, time, previous and new state." actions={<History className="size-4 text-muted" />} bodyClassName="p-0">
        {audit.isLoading && <div className="p-4"><Skeleton className="h-40" /></div>}
        {audit.error && <div className="p-4"><ErrorState error={audit.error} /></div>}
        {audit.data?.items.length === 0 && <EmptyState title="No reviewer actions yet" />}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[12.5px]">
            <thead className="border-b border-line text-[10.5px] uppercase tracking-[0.1em] text-dim"><tr><th className="px-4 py-2">When</th><th className="px-2 py-2">Actor</th><th className="px-2 py-2">Action</th><th className="px-2 py-2">Entity</th><th className="px-2 py-2">Change</th><th className="px-4 py-2">Explanation</th></tr></thead>
            <tbody className="divide-y divide-line/60">
              {audit.data?.items.map((a) => (
                <tr key={a.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-2 text-muted">{timeAgo(a.created_at)}</td>
                  <td className="px-2 py-2">{a.actor_name ?? "—"}<span className="block text-[10px] uppercase text-dim">{a.actor_role}</span></td>
                  <td className="px-2 py-2 font-medium text-accent">{humanize(a.action)}</td>
                  <td className="px-2 py-2">{humanize(a.entity_type)}{a.entity_type === "report" && a.entity_id && <Link href={`/reports/${a.entity_id}`} className="block font-mono text-[10.5px] text-dim hover:text-accent">{String(a.previous_state?.reference ?? a.entity_id.slice(0, 8))}</Link>}</td>
                  <td className="px-2 py-2 text-muted">{diff(a.previous_state, a.new_state).join("; ") || "—"}</td>
                  <td className="px-4 py-2 text-muted">{a.explanation ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

export default function AdminPage() {
  return (
    <div>
      <PageHeader title="Administration" description="Human oversight of AI findings. Reviewers verify, dispute, reject, escalate, merge, separate and resolve — the AI cannot." />
      <RequireStaff what="Administration"><AdminInner /></RequireStaff>
    </div>
  );
}
