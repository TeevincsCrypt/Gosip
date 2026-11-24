"use client";

import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { api, humanize } from "@/lib/client/utils";
import { AGENTS, CATEGORIES, SEVERITIES } from "@/lib/domain/constants";
import { PageHeader } from "@/components/app/shell";
import { EmptyState, ErrorState, Panel, Skeleton } from "@/components/ui/primitives";
import { SEVERITY_COLOR } from "@/components/ui/badges";

interface Analytics {
  byCategoryStatus: { category: string; verification_status: string; count: number }[];
  severityConfidence: { id: string; reference: string; severity: string; confidence: number; category: string }[];
  investigationOutcomes: { status: string; count: number }[];
  agentPerformance: { agent: string; status: string; count: number; avg_ms: number | null }[];
  hourly: { hour: number; count: number }[];
  evidence: { relevance: string; count: number; duplicates: number }[];
  clusterSizes: { report_count: number; independent_source_count: number; reference: string; title: string }[];
  reviewThroughput: { decision: string; count: number }[];
}

const tooltip = { contentStyle: { background: "#151d19", border: "1px solid #26332c", fontSize: 12 }, labelStyle: { color: "#84918a" }, cursor: { fill: "#1a241f" } };
const STATUS_COLORS: Record<string, string> = { unverified: "#5d6a63", corroborated: "#8fb3c9", verified: "#9bcb8b", disputed: "#d9a441", rejected: "#e06b5f" };

export default function AnalyticsPage() {
  const q = useQuery({ queryKey: ["analytics"], queryFn: () => api<Analytics>("/api/analytics") });
  const d = q.data;
  const catRows = CATEGORIES.map((c) => {
    const row: Record<string, number | string> = { category: c.label };
    for (const s of Object.keys(STATUS_COLORS)) row[s] = d?.byCategoryStatus.find((x) => x.category === c.id && x.verification_status === s)?.count ?? 0;
    return row;
  }).filter((r) => Object.keys(STATUS_COLORS).some((s) => Number(r[s]) > 0));
  const sevIndex = (s: string) => SEVERITIES.indexOf(s as (typeof SEVERITIES)[number]);
  const agentRows = AGENTS.map((a) => {
    const rows = d?.agentPerformance.filter((p) => p.agent === a.id) ?? [];
    const ok = rows.find((r) => r.status === "succeeded");
    return {
      agent: `${a.code} ${a.name.replace(" Agent", "").replace("Intelligence ", "")}`,
      succeeded: ok?.count ?? 0,
      failed: rows.filter((r) => r.status === "failed" || r.status === "timed_out").reduce((s, r) => s + r.count, 0),
      skipped: rows.find((r) => r.status === "skipped")?.count ?? 0,
      avg_s: ok?.avg_ms ? Number((ok.avg_ms / 1000).toFixed(1)) : 0,
    };
  });

  return (
    <div>
      <PageHeader title="Incident Analytics" description="Distributions and quality signals across all visible reports, investigations and evidence. Computed live from the database." />
      <div className="grid gap-4 p-4 lg:grid-cols-2 lg:p-6">
        {q.isLoading && <Skeleton className="h-72 lg:col-span-2" />}
        {q.error && <div className="lg:col-span-2"><ErrorState error={q.error} retry={() => q.refetch()} /></div>}
        {d && (
          <>
            <Panel title="Verification status by category">
              <div className="h-72">
                {catRows.length ? (
                  <ResponsiveContainer>
                    <BarChart data={catRows} layout="vertical" margin={{ left: 10, right: 10 }}>
                      <CartesianGrid stroke="#26332c" horizontal={false} />
                      <XAxis type="number" stroke="#5d6a63" fontSize={10} allowDecimals={false} />
                      <YAxis type="category" dataKey="category" width={140} stroke="#84918a" fontSize={11} />
                      <Tooltip {...tooltip} />
                      {Object.entries(STATUS_COLORS).map(([s, c]) => <Bar key={s} dataKey={s} name={humanize(s)} stackId="a" fill={c} barSize={12} />)}
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyState title="No reports" />}
              </div>
            </Panel>
            <Panel title="Severity vs confidence" subtitle="Separate measures: a severe report can have low confidence">
              <div className="h-72">
                {d.severityConfidence.length ? (
                  <ResponsiveContainer>
                    <ScatterChart margin={{ left: -10, right: 10, top: 10 }}>
                      <CartesianGrid stroke="#26332c" />
                      <XAxis type="number" dataKey="confidence" name="Confidence" domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} stroke="#5d6a63" fontSize={10} />
                      <YAxis type="number" dataKey="sev" name="Severity" domain={[-0.5, 3.5]} ticks={[0, 1, 2, 3]} tickFormatter={(v) => SEVERITIES[v] ?? ""} stroke="#5d6a63" fontSize={10} width={80} />
                      <ZAxis range={[60, 60]} />
                      <Tooltip {...tooltip} formatter={(v, n) => (n === "Confidence" ? `${Math.round(Number(v) * 100)}%` : SEVERITIES[Number(v)] ?? v)} />
                      <Scatter data={d.severityConfidence.map((p) => ({ ...p, sev: sevIndex(p.severity) + ((parseInt(p.id.slice(0, 4), 16) % 100) / 100 - 0.5) * 0.3 }))}>
                        {d.severityConfidence.map((p) => <Cell key={p.id} fill={SEVERITY_COLOR[p.severity]} />)}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                ) : <EmptyState title="No assessed reports yet">Points appear after AI investigations complete.</EmptyState>}
              </div>
            </Panel>
            <Panel title="Agent reliability" subtitle="Runs by outcome and mean successful duration">
              <div className="h-72">
                {agentRows.some((r) => r.succeeded + r.failed + r.skipped > 0) ? (
                  <ResponsiveContainer>
                    <BarChart data={agentRows} margin={{ left: -20, right: 10 }}>
                      <CartesianGrid stroke="#26332c" vertical={false} />
                      <XAxis dataKey="agent" stroke="#5d6a63" fontSize={9.5} interval={0} />
                      <YAxis stroke="#5d6a63" fontSize={10} allowDecimals={false} />
                      <Tooltip {...tooltip} />
                      <Bar dataKey="succeeded" name="Succeeded" stackId="a" fill="#6f9a63" />
                      <Bar dataKey="skipped" name="Skipped" stackId="a" fill="#31423a" />
                      <Bar dataKey="failed" name="Failed / timed out" stackId="a" fill="#e06b5f" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyState title="No agent runs yet" />}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[11px] text-muted sm:grid-cols-6">
                {agentRows.map((r) => <span key={r.agent}>{r.agent.split(" ")[0]} {r.avg_s ? `${r.avg_s}s` : "—"}</span>)}
              </div>
            </Panel>
            <Panel title="Investigation outcomes">
              <div className="h-72">
                {d.investigationOutcomes.length ? (
                  <ResponsiveContainer>
                    <BarChart data={d.investigationOutcomes.map((o) => ({ ...o, label: humanize(o.status) }))} margin={{ left: -20 }}>
                      <CartesianGrid stroke="#26332c" vertical={false} />
                      <XAxis dataKey="label" stroke="#5d6a63" fontSize={10} />
                      <YAxis stroke="#5d6a63" fontSize={10} allowDecimals={false} />
                      <Tooltip {...tooltip} />
                      <Bar dataKey="count" name="Investigations" barSize={28}>
                        {d.investigationOutcomes.map((o) => <Cell key={o.status} fill={o.status === "completed" ? "#6f9a63" : o.status === "partial" ? "#d9a441" : o.status === "failed" ? "#e06b5f" : "#5d6a63"} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyState title="No investigations" />}
              </div>
            </Panel>
            <Panel title="Reports by hour of incident (UTC)">
              <div className="h-56">
                <ResponsiveContainer>
                  <BarChart data={Array.from({ length: 24 }, (_, h) => ({ hour: h, count: d.hourly.find((x) => x.hour === h)?.count ?? 0 }))} margin={{ left: -20 }}>
                    <XAxis dataKey="hour" stroke="#5d6a63" fontSize={10} />
                    <YAxis stroke="#5d6a63" fontSize={10} allowDecimals={false} />
                    <Tooltip {...tooltip} />
                    <Bar dataKey="count" name="Reports" fill="#6f9a63" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel title="Evidence quality" bodyClassName="p-0">
              <table className="w-full text-[13px]">
                <thead className="border-b border-line text-[10.5px] uppercase tracking-[0.1em] text-dim"><tr><th className="px-4 py-2 text-left">AI relevance</th><th className="px-4 py-2 text-right">Files</th><th className="px-4 py-2 text-right">Duplicates</th></tr></thead>
                <tbody className="divide-y divide-line/60">
                  {d.evidence.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-xs text-muted">No evidence yet.</td></tr>}
                  {d.evidence.map((e) => <tr key={e.relevance}><td className="px-4 py-2">{humanize(e.relevance)}</td><td className="px-4 py-2 text-right font-mono">{e.count}</td><td className="px-4 py-2 text-right font-mono text-warn">{e.duplicates}</td></tr>)}
                </tbody>
              </table>
              <p className="border-t border-line px-4 py-2 text-[11px] text-dim">Largest clusters: {d.clusterSizes.slice(0, 3).map((c) => `${c.reference} (${c.report_count})`).join(", ") || "none"}</p>
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}
