"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { api, fmtDateTime } from "@/lib/client/utils";
import { AGENTS, AI_DISCLAIMER } from "@/lib/domain/constants";
import type { AgentFindingRow } from "@/lib/domain/types";
import { AgentPipeline, IncompleteNotice } from "@/components/app/agent-pipeline";
import { FindingView } from "@/components/app/finding-view";
import { PageHeader } from "@/components/app/shell";
import { Button, EmptyState, ErrorState, Panel, Skeleton } from "@/components/ui/primitives";
import { ConfidenceMeter, InvestigationBadge, ProvenanceTag, SeverityBadge, SyntheticTag } from "@/components/ui/badges";

interface Data {
  investigation: { id: string; status: string; trigger: string; attempt: number; model: string | null; provider: string | null; severity: string | null; confidence: number | null; started_at: string | null; completed_at: string | null; error?: string | null; summary: Record<string, unknown> | null; needs_human_review: boolean };
  findings: (AgentFindingRow & { tokens_in?: number | null; tokens_out?: number | null })[];
  report: { id: string; reference: string; title: string; is_synthetic: boolean; is_sensitive: boolean } | null;
  events: { id: number; summary: string; created_at: string; actor_type: string }[];
  viewer: { staff: boolean };
}

export default function InvestigationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({
    queryKey: ["investigation", id],
    queryFn: () => api<Data>(`/api/investigations/${id}`),
    refetchInterval: (query) => (["queued", "running"].includes(query.state.data?.investigation.status ?? "") ? 2000 : false),
  });
  const [agent, setAgent] = React.useState<string | null>("classification");
  if (q.isLoading) return <div className="space-y-3 p-6"><Skeleton className="h-20" /><Skeleton className="h-72" /></div>;
  if (q.error || !q.data) return <div className="p-6"><ErrorState error={q.error ?? new Error("Not found")} /></div>;
  const { investigation: inv, findings, report } = q.data;
  const f = findings.find((x) => x.agent === agent);
  const totalMs = findings.reduce((s, x) => s + (x.duration_ms ?? 0), 0);

  return (
    <div>
      <div className="px-4 pt-4 lg:px-6"><Link href="/investigations" className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg"><ArrowLeft className="size-3" /> Investigations</Link></div>
      <PageHeader
        title={`Investigation · ${report?.reference ?? ""}`}
        description={report?.title}
        actions={<>
          <InvestigationBadge status={inv.status} />
          {report?.is_synthetic && <SyntheticTag />}
          {report && <Link href={`/reports/${report.id}`}><Button size="sm" variant="outline">Open report</Button></Link>}
        </>}
      />
      <div className="space-y-4 p-4 lg:p-6">
        <IncompleteNotice status={inv.status} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ["Attempt", `${inv.attempt} (${inv.trigger})`],
            ["Model", inv.model ?? "—"],
            ["Started", fmtDateTime(inv.started_at)],
            ["Completed", fmtDateTime(inv.completed_at)],
            ["Agent time", totalMs ? `${(totalMs / 1000).toFixed(1)} s` : "—"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-line bg-panel p-3">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{k}</p>
              <p className="mt-1 truncate font-mono text-[13px]">{v}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line bg-panel px-4 py-3 text-sm">
          <span className="flex items-center gap-2">Severity <SeverityBadge severity={inv.severity} /></span>
          <span className="flex items-center gap-2">Confidence <ConfidenceMeter value={inv.confidence} /></span>
          <span className={inv.needs_human_review ? "text-warn" : "text-muted"}>{inv.needs_human_review ? "Human review requested" : "No review requested"}</span>
          {q.data.viewer.staff && inv.error && <span className="font-mono text-xs text-danger">{inv.error}</span>}
        </div>
        <Panel title="Agent orchestration" subtitle="A → (B | C | D in parallel) → E → F. Each agent's raw structured output is preserved.">
          {findings.length === 0 ? <EmptyState title="No agents ran">{inv.status === "not_configured" ? "AI provider not configured." : ""}</EmptyState> : <AgentPipeline findings={findings} selected={agent} onSelect={setAgent} />}
        </Panel>
        {f && (
          <Panel
            title={AGENTS.find((a) => a.id === f.agent)?.name}
            subtitle={`Status ${f.status} · ${f.attempts} attempt(s)${f.duration_ms ? ` · ${(f.duration_ms / 1000).toFixed(1)} s` : ""}${f.tokens_in ? ` · ${f.tokens_in} in / ${f.tokens_out} out tokens` : ""}`}
            actions={<>{f.output && <ProvenanceTag kind="ai_assessment" />}{f.deterministic && <ProvenanceTag kind="deterministic" />}</>}
          >
            {(f.error || f.error_summary) && <p className="mb-3 rounded-md border border-danger/30 bg-danger/5 p-2 font-mono text-[11.5px] text-danger">{f.error ?? f.error_summary}</p>}
            {f.input_refs && Object.keys(f.input_refs).length > 0 && (
              <div className="mb-4 rounded-md border border-line bg-bg-2 p-3"><p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-dim">Inputs used</p><FindingView value={f.input_refs} depth={1} /></div>
            )}
            {f.output ? <FindingView value={f.output} /> : !f.error && <p className="text-sm text-dim">{report?.is_sensitive && !q.data.viewer.staff ? "Restricted for sensitive reports." : "No output."}</p>}
            {f.deterministic && <details className="mt-4 rounded-md border border-line p-3"><summary className="cursor-pointer text-xs text-muted">Deterministic checks</summary><div className="mt-3"><FindingView value={f.deterministic} /></div></details>}
          </Panel>
        )}
        <Panel title="Execution log">
          <ol className="space-y-1.5 font-mono text-[12px]">
            {q.data.events.map((e) => <li key={e.id} className="flex gap-3"><span className="shrink-0 text-dim">{new Date(e.created_at).toISOString().slice(11, 19)}</span><span className="text-fg/85">{e.summary}</span></li>)}
          </ol>
          <p className="mt-4 text-[11px] text-dim">{AI_DISCLAIMER}</p>
        </Panel>
      </div>
    </div>
  );
}
