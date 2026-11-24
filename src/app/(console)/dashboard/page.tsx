"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowUpRight, FlaskConical, MapPin, Waypoints } from "lucide-react";
import { api, cn, timeAgo } from "@/lib/client/utils";
import { categoryLabel } from "@/lib/domain/constants";
import { PageHeader } from "@/components/app/shell";
import { LiveFeed } from "@/components/app/live-feed";
import { EmptyState, ErrorState, Panel, Skeleton } from "@/components/ui/primitives";
import { CategoryTag, ConfidenceMeter, SeverityBadge, SEVERITY_COLOR, SyntheticTag, VerificationBadge } from "@/components/ui/badges";

interface Stats {
  counts: Record<string, number>;
  clusters: { active: number; reports_in_clusters: number };
  byCategory: { category: string; count: number }[];
  bySeverity: { severity: string | null; count: number }[];
  activity: { day: string; count: number }[];
  hotspots: { lat: number; lng: number; count: number; place: string; max_severity: string | null }[];
  activeClusters: { id: string; reference: string; title: string; primary_category: string; report_count: number; independent_source_count: number; last_reported_at: string; is_synthetic: boolean }[];
  priority: { id: string; reference: string; title: string; category: string; severity: string; confidence: number | null; verification_status: string; location_text: string; occurred_at: string; is_synthetic: boolean; priority_escalated: boolean }[];
  generatedAt: string;
}

const KPIS: { key: string; label: string; hint: string; tone?: string; href?: string }[] = [
  { key: "total", label: "Total reports", hint: "All visible reports", href: "/reports" },
  { key: "active", label: "Active incidents", hint: "Lifecycle: active", href: "/reports" },
  { key: "under_investigation", label: "Under investigation", hint: "AI agents queued or running", tone: "text-accent", href: "/investigations" },
  { key: "corroborated", label: "Corroborated", hint: "≥2 independent sources", tone: "text-info", href: "/reports?verification=corroborated" },
  { key: "verified", label: "Verified", hint: "By a human reviewer", tone: "text-accent", href: "/reports?verification=verified" },
  { key: "disputed", label: "Disputed", hint: "Marked disputed by reviewer", tone: "text-warn", href: "/reports?verification=disputed" },
  { key: "high_priority", label: "High priority", hint: "HIGH/CRITICAL or escalated", tone: "text-danger", href: "/reports?severity=HIGH,CRITICAL" },
  { key: "recently_resolved", label: "Recently resolved", hint: "Resolved in last 7 days", href: "/reports" },
];

function Kpi({ label, value, hint, tone, href }: { label: string; value: number | undefined; hint: string; tone?: string; href?: string }) {
  const inner = (
    <div className="group h-full rounded-lg border border-line bg-panel px-4 py-3 transition-colors hover:border-line-2">
      <p className="flex items-center justify-between text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
        {href && <ArrowUpRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />}
      </p>
      <p className={cn("mt-1.5 font-mono text-[28px] leading-none tabular-nums", tone ?? "text-fg")}>{value ?? "—"}</p>
      <p className="mt-1.5 text-[11px] text-dim">{hint}</p>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export default function DashboardPage() {
  const [excludeSynthetic, setExcludeSynthetic] = React.useState(false);
  const q = useQuery({
    queryKey: ["stats", excludeSynthetic],
    queryFn: () => api<Stats>(`/api/stats${excludeSynthetic ? "?synthetic=exclude" : ""}`),
  });
  const s = q.data;

  return (
    <div>
      <PageHeader
        title="Global Intelligence Command Centre"
        description="Live situational picture computed from submitted reports, AI investigations and cross-report correlation. Every figure below is a live database count."
        actions={
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-line bg-panel px-3 py-1.5 text-xs text-muted">
            <input type="checkbox" checked={excludeSynthetic} onChange={(e) => setExcludeSynthetic(e.target.checked)} className="accent-[#9bcb8b]" />
            Exclude synthetic demo data
          </label>
        }
      />
      <div className="space-y-4 p-4 lg:p-6">
        {q.error && <ErrorState error={q.error} retry={() => q.refetch()} />}
        {s && s.counts.synthetic > 0 && !excludeSynthetic && (
          <div className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn">
            <FlaskConical className="mt-0.5 size-3.5 shrink-0" />
            <span>
              These figures include <strong>{s.counts.synthetic}</strong> clearly labelled synthetic demonstration reports. They describe incidents that did not happen.
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
          {KPIS.map((k) =>
            q.isLoading ? <Skeleton key={k.key} className="h-[92px]" /> : <Kpi {...k} key={k.key} value={s?.counts[k.key]} />,
          )}
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <div className="space-y-4 xl:col-span-2">
            <div className="grid gap-4 md:grid-cols-3">
              <Panel title="Active investigation clusters" className="md:col-span-1" bodyClassName="p-0">
                <div className="px-4 py-3">
                  <p className="font-mono text-[28px] leading-none text-accent">{s?.clusters.active ?? "—"}</p>
                  <p className="mt-1 text-[11px] text-dim">{s ? `${s.clusters.reports_in_clusters} reports correlated into clusters` : ""}</p>
                </div>
                <ul className="border-t border-line">
                  {s?.activeClusters.length === 0 && <li className="px-4 py-4 text-xs text-muted">No clusters yet.</li>}
                  {s?.activeClusters.map((c) => (
                    <li key={c.id} className="border-b border-line/60 last:border-0">
                      <Link href={`/intelligence-graph?cluster=${c.id}`} className="flex items-center gap-2 px-4 py-2 hover:bg-panel-2">
                        <Waypoints className="size-3.5 shrink-0 text-accent" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] text-fg">{c.title}</span>
                          <span className="block text-[10.5px] text-dim">
                            {c.report_count} reports · {c.independent_source_count} independent · {timeAgo(c.last_reported_at)}
                          </span>
                        </span>
                        {c.is_synthetic && <SyntheticTag />}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Panel>
              <Panel title="Reporting activity · 14 days" className="md:col-span-2">
                <div className="h-48">
                  {s && (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={s.activity} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                        <defs>
                          <linearGradient id="act" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0" stopColor="#9bcb8b" stopOpacity={0.35} />
                            <stop offset="1" stopColor="#9bcb8b" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#26332c" vertical={false} />
                        <XAxis dataKey="day" tickFormatter={(d) => d.slice(5)} stroke="#5d6a63" fontSize={10} tickLine={false} axisLine={false} />
                        <YAxis allowDecimals={false} stroke="#5d6a63" fontSize={10} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={{ background: "#151d19", border: "1px solid #26332c", fontSize: 12 }} labelStyle={{ color: "#84918a" }} />
                        <Area type="monotone" dataKey="count" name="Reports" stroke="#9bcb8b" strokeWidth={1.5} fill="url(#act)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </Panel>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Panel title="Incidents by category">
                <div className="h-56">
                  {s && s.byCategory.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={s.byCategory.map((c) => ({ ...c, label: categoryLabel(c.category) }))} layout="vertical" margin={{ left: 8, right: 12, top: 0, bottom: 0 }}>
                        <XAxis type="number" hide allowDecimals={false} />
                        <YAxis type="category" dataKey="label" width={130} stroke="#84918a" fontSize={11} tickLine={false} axisLine={false} />
                        <Tooltip cursor={{ fill: "#1a241f" }} contentStyle={{ background: "#151d19", border: "1px solid #26332c", fontSize: 12 }} />
                        <Bar dataKey="count" name="Reports" fill="#6f9a63" radius={[0, 3, 3, 0]} barSize={12} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyState title="No reports yet" />
                  )}
                </div>
              </Panel>
              <Panel title="Geographic distribution · hotspots" subtitle="Reports grouped on a 1° grid" bodyClassName="p-0">
                <ul>
                  {s?.hotspots.length === 0 && <li className="p-4 text-xs text-muted">No geolocated reports.</li>}
                  {s?.hotspots.map((h) => (
                    <li key={`${h.lat},${h.lng}`} className="flex items-center gap-3 border-b border-line/60 px-4 py-2 last:border-0">
                      <MapPin className="size-3.5 shrink-0" style={{ color: SEVERITY_COLOR[h.max_severity ?? "NONE"] }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px]">{h.place}</span>
                        <span className="block font-mono text-[10.5px] text-dim">
                          {h.lat}°, {h.lng}°
                        </span>
                      </span>
                      <span className="w-24">
                        <span className="block h-1.5 rounded-full bg-line">
                          <span className="block h-1.5 rounded-full bg-accent/70" style={{ width: `${Math.min(100, (h.count / Math.max(...s.hotspots.map((x) => x.count))) * 100)}%` }} />
                        </span>
                      </span>
                      <span className="w-6 text-right font-mono text-xs">{h.count}</span>
                    </li>
                  ))}
                </ul>
                <div className="border-t border-line px-4 py-2 text-right">
                  <Link href="/map" className="text-xs text-accent hover:underline">
                    Open live map →
                  </Link>
                </div>
              </Panel>
            </div>

            <Panel title="High-priority incidents" subtitle="Severity is an AI assessment unless escalated by a reviewer" bodyClassName="p-0">
              {s?.priority.length === 0 && <EmptyState title="No high-priority incidents" />}
              <div className="divide-y divide-line/60">
                {s?.priority.map((r) => (
                  <Link key={r.id} href={`/reports/${r.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-panel-2">
                    <SeverityBadge severity={r.severity} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px]">{r.title}</span>
                      <span className="block text-[11px] text-dim">
                        {r.reference} · {r.location_text} · {timeAgo(r.occurred_at)}
                      </span>
                    </span>
                    {r.priority_escalated && <span className="text-[10px] font-semibold uppercase tracking-wider text-danger">Escalated</span>}
                    <CategoryTag category={r.category} />
                    <VerificationBadge status={r.verification_status} />
                    <ConfidenceMeter value={r.confidence} />
                    {r.is_synthetic && <SyntheticTag />}
                  </Link>
                ))}
              </div>
            </Panel>
          </div>

          <Panel
            title="Live incident activity"
            actions={
              <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-accent">
                <span className="size-1.5 animate-pulse rounded-full bg-accent" /> Live
              </span>
            }
            bodyClassName="max-h-[860px] overflow-y-auto py-1"
          >
            <LiveFeed limit={40} compact />
          </Panel>
        </div>
      </div>
    </div>
  );
}
