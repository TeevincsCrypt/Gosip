"use client";

import * as React from "react";
import { AlertTriangle, Brain, CheckCircle2, CircleDashed, Clock, Loader2, MinusCircle, XCircle } from "lucide-react";
import { AGENTS } from "@/lib/domain/constants";
import type { AgentFindingRow } from "@/lib/domain/types";
import { cn } from "@/lib/client/utils";

const STATUS_ICON: Record<string, { icon: typeof Brain; tone: string; label: string }> = {
  pending: { icon: CircleDashed, tone: "text-dim", label: "Pending" },
  running: { icon: Loader2, tone: "text-accent animate-spin", label: "Running" },
  succeeded: { icon: CheckCircle2, tone: "text-accent", label: "Completed" },
  failed: { icon: XCircle, tone: "text-danger", label: "Failed" },
  timed_out: { icon: Clock, tone: "text-danger", label: "Timed out" },
  skipped: { icon: MinusCircle, tone: "text-muted", label: "Skipped" },
};

/** Stage layout: A → (B | C | D) → E → F, mirroring the orchestrator. */
const STAGES: { title: string; agents: string[] }[] = [
  { title: "Stage 1", agents: ["classification"] },
  { title: "Stage 2 · parallel", agents: ["evidence", "geospatial", "corroboration"] },
  { title: "Stage 3", agents: ["threat"] },
  { title: "Stage 4 · synthesis", agents: ["lead"] },
];

export function AgentPipeline({
  findings,
  selected,
  onSelect,
}: {
  findings: AgentFindingRow[];
  selected?: string | null;
  onSelect?: (agent: string) => void;
}) {
  const byAgent = new Map(findings.map((f) => [f.agent, f]));
  return (
    <div className="grid gap-3 md:grid-cols-4">
      {STAGES.map((stage) => (
        <div key={stage.title} className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-dim">{stage.title}</p>
          {stage.agents.map((id) => {
            const agent = AGENTS.find((a) => a.id === id)!;
            const f = byAgent.get(agent.id);
            const st = STATUS_ICON[f?.status ?? "pending"];
            const Icon = st.icon;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelect?.(id)}
                className={cn(
                  "w-full rounded-md border bg-bg-2 p-2.5 text-left transition-colors",
                  selected === id ? "border-accent/60" : "border-line hover:border-line-2",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] text-dim">AGENT {agent.code}</p>
                    <p className="text-[12.5px] font-medium leading-tight text-fg">{agent.name.replace(" Agent", "")}</p>
                  </div>
                  <Icon className={cn("size-4 shrink-0", st.tone)} />
                </div>
                <p className="mt-1.5 flex items-center justify-between text-[10.5px] text-muted">
                  <span>{st.label}{f && f.attempts > 1 ? ` · ${f.attempts} attempts` : ""}</span>
                  {f?.duration_ms ? <span className="font-mono">{(f.duration_ms / 1000).toFixed(1)}s</span> : null}
                </p>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function AgentStatusDots({ agents }: { agents: { agent: string; status: string }[] | null }) {
  const map = new Map((agents ?? []).map((a) => [a.agent, a.status]));
  return (
    <span className="inline-flex items-center gap-1" aria-label="Agent statuses">
      {AGENTS.map((a) => {
        const s = map.get(a.id) ?? "none";
        return (
          <span
            key={a.id}
            title={`${a.name}: ${s}`}
            className={cn(
              "grid size-4 place-items-center rounded-sm font-mono text-[9px]",
              s === "succeeded" && "bg-accent/20 text-accent",
              s === "running" && "animate-pulse bg-accent/30 text-accent",
              (s === "failed" || s === "timed_out") && "bg-danger/20 text-danger",
              s === "skipped" && "bg-line text-muted",
              (s === "pending" || s === "none") && "border border-line text-dim",
            )}
          >
            {a.code}
          </span>
        );
      })}
    </span>
  );
}

export function IncompleteNotice({ status }: { status: string }) {
  if (status !== "partial" && status !== "failed" && status !== "not_configured") return null;
  const text =
    status === "not_configured"
      ? "No AI investigation was performed because the AI provider is not configured on this deployment. The report is queued for human review."
      : status === "failed"
        ? "This investigation failed. No synthesis is available; individual agent results (if any) are shown as-is. A reviewer can retry."
        : "This investigation is INCOMPLETE: at least one agent did not finish. Conclusions below are based only on the agents that completed.";
  return (
    <div role="status" className={cn("flex gap-2 rounded-md border px-3 py-2.5 text-xs leading-relaxed", status === "not_configured" ? "border-line-2 bg-bg-2 text-muted" : "border-warn/40 bg-warn/5 text-warn")}>
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}
