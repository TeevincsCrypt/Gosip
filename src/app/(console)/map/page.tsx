"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Layers, SlidersHorizontal, Waypoints, X } from "lucide-react";
import { api, cn, fmtDateTime, timeAgo } from "@/lib/client/utils";
import { CATEGORIES, SEVERITIES } from "@/lib/domain/constants";
import { IncidentMap, type MapCluster, type MapReport } from "@/components/app/incident-map";
import { Button, ErrorState, Skeleton } from "@/components/ui/primitives";
import { CategoryTag, ConfidenceMeter, InvestigationBadge, SeverityBadge, SEVERITY_COLOR, SyntheticTag, VerificationBadge } from "@/components/ui/badges";

type Report = MapReport & { location_text: string; occurred_at: string; confidence: number | null; lifecycle_status: string; priority_escalated: boolean };
type Cluster = MapCluster & { primary_category: string; independent_source_count: number; is_synthetic: boolean; first_reported_at: string; last_reported_at: string };

const STATUSES = ["unverified", "corroborated", "verified", "disputed"];

function toggle<T>(set: Set<T>, v: T) {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

function MapInner() {
  const params = useSearchParams();
  const q = useQuery({ queryKey: ["map"], queryFn: () => api<{ reports: Report[]; clusters: Cluster[] }>("/api/map") });
  const [cats, setCats] = React.useState<Set<string>>(new Set());
  const [sevs, setSevs] = React.useState<Set<string>>(new Set());
  const [stats, setStats] = React.useState<Set<string>>(new Set());
  const [heat, setHeat] = React.useState(false);
  const [showClusters, setShowClusters] = React.useState(true);
  const [panelOpen, setPanelOpen] = React.useState(() => typeof window === "undefined" || window.innerWidth >= 768);
  const [selected, setSelected] = React.useState<string | null>(params.get("report"));
  const [selectedCluster, setSelectedCluster] = React.useState<string | null>(null);

  const reports = React.useMemo(
    () =>
      (q.data?.reports ?? []).filter(
        (r) =>
          (!cats.size || cats.has(r.category)) &&
          (!sevs.size || sevs.has(r.severity ?? "UNASSESSED")) &&
          (!stats.size || stats.has(r.verification_status)),
      ),
    [q.data, cats, sevs, stats],
  );
  const sel = q.data?.reports.find((r) => r.id === selected) ?? null;
  const selCluster = q.data?.clusters.find((c) => c.id === selectedCluster) ?? null;
  const clusterMembers = selCluster ? (q.data?.reports ?? []).filter((r) => r.cluster_id === selCluster.id).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)) : [];

  return (
    <div className="relative h-[calc(100dvh-3.5rem)]">
      {q.isLoading && <Skeleton className="absolute inset-0 rounded-none" />}
      {q.error && <div className="p-6"><ErrorState error={q.error} retry={() => q.refetch()} /></div>}
      {q.data && (
        <IncidentMap
          className="absolute inset-0"
          reports={reports}
          clusters={showClusters ? q.data.clusters : []}
          selectedId={selected}
          selectedClusterId={selectedCluster}
          onSelectReport={(id) => { setSelected(id); setSelectedCluster(null); }}
          onSelectCluster={(id) => { setSelectedCluster(id); setSelected(null); }}
          showHeat={heat}
          fitPaddingLeft={340}
        />
      )}

      {/* Filters */}
      <div className="absolute left-3 top-3 z-10 w-[min(300px,calc(100%-24px))]">
        <div className="rounded-lg border border-line bg-panel/95 shadow-xl backdrop-blur">
          <button className="flex w-full items-center justify-between px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted" onClick={() => setPanelOpen((o) => !o)}>
            <span className="flex items-center gap-1.5"><SlidersHorizontal className="size-3.5" /> Filters · {reports.length} shown</span>
            <span>{panelOpen ? "−" : "+"}</span>
          </button>
          {panelOpen && (
            <div className="max-h-[60dvh] space-y-3 overflow-y-auto border-t border-line p-3 text-xs">
              <div>
                <p className="mb-1.5 text-[10px] uppercase tracking-wider text-dim">Category</p>
                <div className="flex flex-wrap gap-1">
                  {CATEGORIES.map((c) => (
                    <button key={c.id} onClick={() => setCats(toggle(cats, c.id))} className={cn("rounded-sm border px-1.5 py-0.5", cats.has(c.id) ? "border-accent/60 bg-accent/10 text-accent" : "border-line text-muted hover:text-fg")}>{c.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-[10px] uppercase tracking-wider text-dim">Severity</p>
                <div className="flex flex-wrap gap-1">
                  {[...SEVERITIES, "UNASSESSED"].map((s) => (
                    <button key={s} onClick={() => setSevs(toggle(sevs, s))} className={cn("flex items-center gap-1 rounded-sm border px-1.5 py-0.5", sevs.has(s) ? "border-accent/60 bg-accent/10 text-fg" : "border-line text-muted hover:text-fg")}>
                      <span className="size-2 rounded-full" style={{ background: SEVERITY_COLOR[s] ?? SEVERITY_COLOR.NONE }} />{s}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-[10px] uppercase tracking-wider text-dim">Investigation status</p>
                <div className="flex flex-wrap gap-1">
                  {STATUSES.map((s) => (
                    <button key={s} onClick={() => setStats(toggle(stats, s))} className={cn("rounded-sm border px-1.5 py-0.5 capitalize", stats.has(s) ? "border-accent/60 bg-accent/10 text-fg" : "border-line text-muted hover:text-fg")}>{s}</button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-3 border-t border-line pt-2">
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={showClusters} onChange={(e) => setShowClusters(e.target.checked)} className="accent-[#9bcb8b]" /><Waypoints className="size-3" /> Incident clusters</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={heat} onChange={(e) => setHeat(e.target.checked)} className="accent-[#9bcb8b]" /><Layers className="size-3" /> Hotspots</label>
              </div>
              {(cats.size > 0 || sevs.size > 0 || stats.size > 0) && (
                <button className="text-accent hover:underline" onClick={() => { setCats(new Set()); setSevs(new Set()); setStats(new Set()); }}>Clear filters</button>
              )}
              <div className="space-y-1 border-t border-line pt-2 text-[10.5px] text-dim">
                <p>Ring colour: <span className="text-info">corroborated</span> · <span className="text-accent">verified</span> · <span className="text-warn">disputed</span></p>
                <p>Halo = approximate location (protected sensitive report).</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Detail drawer */}
      {(sel || selCluster) && (
        <aside className="absolute inset-x-3 bottom-3 z-10 max-h-[55dvh] overflow-y-auto rounded-lg border border-line bg-panel/95 shadow-xl backdrop-blur md:inset-x-auto md:right-3 md:top-3 md:bottom-auto md:w-96 md:max-h-[calc(100%-24px)]">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{sel ? "Incident" : "Incident cluster"}</span>
            <button aria-label="Close" onClick={() => { setSelected(null); setSelectedCluster(null); }} className="text-muted hover:text-fg"><X className="size-4" /></button>
          </div>
          {sel && (
            <div className="space-y-3 p-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[11px] text-accent">{sel.reference}</span>
                <CategoryTag category={sel.category} />
                {sel.is_synthetic && <SyntheticTag />}
              </div>
              <p className="text-sm font-medium">{sel.title}</p>
              <p className="text-xs text-muted">{sel.location_text} · {fmtDateTime(sel.occurred_at)}</p>
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={sel.severity} />
                <ConfidenceMeter value={sel.confidence} />
                <VerificationBadge status={sel.verification_status} />
                <InvestigationBadge status={sel.investigation_status} />
              </div>
              {sel.location_precision === "approximate" && <p className="text-[11px] text-warn">Location shown approximately to protect people involved.</p>}
              <div className="flex gap-2">
                <Link href={`/reports/${sel.id}`}><Button size="sm" variant="primary">Open report</Button></Link>
                {sel.cluster_id && <Button size="sm" variant="outline" onClick={() => { setSelectedCluster(sel.cluster_id); setSelected(null); }}>View cluster</Button>}
              </div>
            </div>
          )}
          {selCluster && (
            <div className="space-y-3 p-3">
              <div className="flex items-center gap-2"><span className="font-mono text-[11px] text-accent">{selCluster.reference}</span>{selCluster.is_synthetic && <SyntheticTag />}</div>
              <p className="text-sm font-medium">{selCluster.title}</p>
              <p className="text-xs text-muted">{selCluster.report_count} reports · {selCluster.independent_source_count} independent sources · radius {(Number(selCluster.radius_m) / 1000).toFixed(1)} km</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-dim">Timeline</p>
              <ol className="space-y-2 border-l border-line pl-3">
                {clusterMembers.map((m) => (
                  <li key={m.id}>
                    <button className="text-left" onClick={() => { setSelected(m.id); setSelectedCluster(null); }}>
                      <p className="text-[12px] hover:text-accent">{m.title}</p>
                      <p className="text-[10.5px] text-dim">{fmtDateTime(m.occurred_at)} · {timeAgo(m.occurred_at)}</p>
                    </button>
                  </li>
                ))}
              </ol>
              <div className="flex gap-2">
                <Link href={`/intelligence-graph?cluster=${selCluster.id}`}><Button size="sm" variant="primary">Open in graph</Button></Link>
                <Link href={`/reports?cluster=${selCluster.id}`}><Button size="sm" variant="outline">List reports</Button></Link>
              </div>
            </div>
          )}
        </aside>
      )}
      {q.data && q.data.reports.length === 0 && (
        <div className="absolute inset-x-0 top-1/3 z-10 mx-auto w-fit rounded-lg border border-line bg-panel px-4 py-3 text-center text-sm text-muted">
          No geolocated reports yet. <Link className="text-accent hover:underline" href="/report">Submit one</Link>.
        </div>
      )}
    </div>
  );
}

export default function MapPage() {
  return (
    <React.Suspense fallback={<Skeleton className="h-[calc(100dvh-3.5rem)] rounded-none" />}>
      <MapInner />
    </React.Suspense>
  );
}
