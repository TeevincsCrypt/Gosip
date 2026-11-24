"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Paperclip } from "lucide-react";
import { api, cn, timeAgo } from "@/lib/client/utils";
import { PageHeader } from "@/components/app/shell";
import { RequireStaff } from "@/components/app/require-role";
import { Button, EmptyState, ErrorState, Input, Panel, Skeleton } from "@/components/ui/primitives";
import { Badge, CategoryTag, ConfidenceMeter, InvestigationBadge, SeverityBadge, SyntheticTag, VerificationBadge } from "@/components/ui/badges";

interface Item {
  id: string; reference: string; title: string; category: string; severity: string | null; confidence: number | null; verification_status: string; investigation_status: string;
  priority_escalated: boolean; location_text: string; occurred_at: string; submitted_at: string; is_anonymous: boolean; is_synthetic: boolean; is_sensitive: boolean; evidence_count: number; review_reasons: string[] | null;
}

function Row({ item }: { item: Item }) {
  const qc = useQueryClient();
  const [notes, setNotes] = React.useState("");
  const m = useMutation({
    mutationFn: (action: string) => api<{ summary: string }>("/api/admin/review", { method: "POST", body: JSON.stringify({ action, reportId: item.id, notes: notes || undefined }) }),
    onSuccess: () => { setNotes(""); qc.invalidateQueries(); },
  });
  return (
    <li className={cn("space-y-2 px-4 py-3", item.priority_escalated && "shadow-[inset_3px_0_0_var(--color-danger)]")}>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/reports/${item.id}`} className="font-mono text-xs text-accent hover:underline">{item.reference}</Link>
        <SeverityBadge severity={item.severity} />
        <ConfidenceMeter value={item.confidence} />
        <VerificationBadge status={item.verification_status} />
        <InvestigationBadge status={item.investigation_status} />
        <CategoryTag category={item.category} />
        {item.priority_escalated && <Badge className="border-danger/50 bg-danger/15 text-danger">Escalated</Badge>}
        {item.is_sensitive && <Badge className="border-warn/40 text-warn">Sensitive</Badge>}
        {item.is_synthetic && <SyntheticTag />}
        {item.evidence_count > 0 && <span className="flex items-center gap-0.5 text-[11px] text-dim"><Paperclip className="size-3" />{item.evidence_count}</span>}
      </div>
      <Link href={`/reports/${item.id}`} className="block text-[14px] hover:text-accent">{item.title}</Link>
      <p className="text-xs text-muted">{item.location_text} · submitted {timeAgo(item.submitted_at)} · {item.is_anonymous ? "anonymous" : "identified submitter"}</p>
      {item.review_reasons && item.review_reasons.length > 0 && <p className="text-xs text-warn">Review requested: {item.review_reasons.join("; ")}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Decision notes (audited)" className="h-7 max-w-xs text-xs" />
        <Button size="sm" variant="primary" loading={m.isPending && m.variables === "verify"} onClick={() => m.mutate("verify")}>Verify</Button>
        <Button size="sm" variant="outline" onClick={() => m.mutate("dispute")}>Dispute</Button>
        <Button size="sm" variant="danger" onClick={() => m.mutate("reject")}>Reject</Button>
        {!item.priority_escalated && <Button size="sm" variant="danger" onClick={() => m.mutate("escalate")}>Escalate</Button>}
        <Button size="sm" variant="ghost" onClick={() => m.mutate("resolve")}>Resolve</Button>
        {m.data && <span className="flex items-center gap-1 text-xs text-accent"><CheckCircle2 className="size-3" />{m.data.summary}</span>}
        {m.error && <span className="text-xs text-danger">{(m.error as Error).message}</span>}
      </div>
    </li>
  );
}

function QueueInner() {
  const q = useQuery({ queryKey: ["queue"], queryFn: () => api<{ items: Item[] }>("/api/admin/queue") });
  return (
    <div className="p-4 lg:p-6">
      <Panel title={q.data ? `${q.data.items.length} report(s) awaiting a human decision` : "Queue"} subtitle="Ordered by escalation, review request and severity" bodyClassName="p-0">
        {q.isLoading && <div className="p-4"><Skeleton className="h-48" /></div>}
        {q.error && <div className="p-4"><ErrorState error={q.error} retry={() => q.refetch()} /></div>}
        {q.data?.items.length === 0 && <EmptyState title="Queue is clear">All active reports have a human decision.</EmptyState>}
        <ul className="divide-y divide-line/60">{q.data?.items.map((i) => <Row key={i.id} item={i} />)}</ul>
      </Panel>
    </div>
  );
}

export default function ReviewQueuePage() {
  return (
    <div>
      <PageHeader title="Human Review Queue" description="AI findings are recommendations. Only reviewers can verify, reject, dispute, escalate or resolve — and every decision is audited." />
      <RequireStaff what="The review queue"><QueueInner /></RequireStaff>
    </div>
  );
}
