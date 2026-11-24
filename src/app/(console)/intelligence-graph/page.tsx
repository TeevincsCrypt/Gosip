"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { Network, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { api, cn, distance, fmtDateTime, humanize } from "@/lib/client/utils";
import { categoryLabel } from "@/lib/domain/constants";
import { PageHeader } from "@/components/app/shell";
import { Button, EmptyState, ErrorState, Panel, Skeleton } from "@/components/ui/primitives";
import { Badge, ConfidenceMeter, ProvenanceTag, SeverityBadge, SEVERITY_COLOR, SyntheticTag, VerificationBadge } from "@/components/ui/badges";

interface GraphData {
  reports: { id: string; reference: string; title: string; category: string; location_text: string; occurred_at: string; severity: string | null; verification_status: string; cluster_id: string | null; is_synthetic: boolean; evidence_count: number }[];
  relationships: { id: string; report_a: string; report_b: string; relationship_type: string; score: number; explanation: string; source: string; status: string; distance_m: number | null; time_delta_minutes: number | null; components: Record<string, number | null> }[];
  clusters: { id: string; reference: string; title: string; primary_category: string; report_count: number; independent_source_count: number; explanation: string; is_synthetic: boolean }[];
  evidence: { id: string; report_id: string; file_kind: string; ai_relevance: string | null; is_duplicate: boolean; duplicate_kind: string | null }[];
  findings: { id: string; report_id: string; status: string; severity: string | null; confidence: number | null }[];
}

type Kind = "cluster" | "report" | "evidence" | "place" | "time" | "finding";
interface Node extends SimulationNodeDatum { id: string; kind: Kind; label: string; data?: unknown }
interface Edge extends SimulationLinkDatum<Node> { id: string; kind: string; data?: unknown }

const LAYERS: { kind: Kind; label: string }[] = [
  { kind: "evidence", label: "Evidence" },
  { kind: "place", label: "Places" },
  { kind: "time", label: "Time periods" },
  { kind: "finding", label: "AI findings" },
];

const EDGE_STYLE: Record<string, { stroke: string; dash?: string; width: number }> = {
  corroborating: { stroke: "#8fb3c9", width: 2 },
  related: { stroke: "#8fb3c9", dash: "5 4", width: 1.5 },
  possible_duplicate: { stroke: "#d9a441", dash: "2 3", width: 1.5 },
  human: { stroke: "#9bcb8b", width: 2.2 },
  rejected: { stroke: "#5d6a63", dash: "1 4", width: 1 },
  member: { stroke: "#31423a", width: 1 },
  aux: { stroke: "#26332c", width: 0.8 },
};

function build(data: GraphData, layers: Set<Kind>) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  for (const c of data.clusters) nodes.push({ id: `c:${c.id}`, kind: "cluster", label: c.reference, data: c });
  for (const r of data.reports) {
    nodes.push({ id: `r:${r.id}`, kind: "report", label: r.reference.slice(-6), data: r });
    if (r.cluster_id) edges.push({ id: `m:${r.id}`, source: `r:${r.id}`, target: `c:${r.cluster_id}`, kind: "member" });
  }
  for (const rel of data.relationships) {
    const kind = rel.status === "rejected_by_reviewer" ? "rejected" : rel.source === "human" ? "human" : rel.relationship_type;
    edges.push({ id: `rel:${rel.id}`, source: `r:${rel.report_a}`, target: `r:${rel.report_b}`, kind, data: rel });
  }
  if (layers.has("evidence")) {
    for (const e of data.evidence) {
      nodes.push({ id: `e:${e.id}`, kind: "evidence", label: e.file_kind, data: e });
      edges.push({ id: `ev:${e.id}`, source: `r:${e.report_id}`, target: `e:${e.id}`, kind: "aux" });
    }
  }
  if (layers.has("place")) {
    const places = new Map<string, string[]>();
    for (const r of data.reports) places.set(r.location_text, [...(places.get(r.location_text) ?? []), r.id]);
    for (const [p, ids] of places) {
      nodes.push({ id: `p:${p}`, kind: "place", label: p, data: { place: p, reports: ids.length } });
      for (const id of ids) edges.push({ id: `pl:${p}:${id}`, source: `r:${id}`, target: `p:${p}`, kind: "aux" });
    }
  }
  if (layers.has("time")) {
    const buckets = new Map<string, string[]>();
    for (const r of data.reports) {
      const d = new Date(r.occurred_at);
      const key = `${d.toISOString().slice(0, 10)} ${String(Math.floor(d.getUTCHours() / 6) * 6).padStart(2, "0")}:00`;
      buckets.set(key, [...(buckets.get(key) ?? []), r.id]);
    }
    for (const [t, ids] of buckets) {
      nodes.push({ id: `t:${t}`, kind: "time", label: t.slice(5), data: { period: `${t} UTC (6 h window)`, reports: ids.length } });
      for (const id of ids) edges.push({ id: `tm:${t}:${id}`, source: `r:${id}`, target: `t:${t}`, kind: "aux" });
    }
  }
  if (layers.has("finding")) {
    for (const f of data.findings) {
      nodes.push({ id: `f:${f.id}`, kind: "finding", label: "AI", data: f });
      edges.push({ id: `fd:${f.id}`, source: `r:${f.report_id}`, target: `f:${f.id}`, kind: "aux" });
    }
  }
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, edges: edges.filter((e) => ids.has(e.source as string) && ids.has(e.target as string)) };
}

function useLayout(data: GraphData | undefined, layers: Set<Kind>) {
  return React.useMemo(() => {
    if (!data) return null;
    const { nodes, edges } = build(data, layers);
    const sim = forceSimulation(nodes)
      .force("link", forceLink<Node, Edge>(edges).id((n) => n.id).distance((e) => (e.kind === "member" ? 70 : e.kind === "aux" ? 40 : 90)).strength((e) => (e.kind === "aux" ? 0.6 : 0.4)))
      .force("charge", forceManyBody().strength((n) => ((n as Node).kind === "cluster" ? -500 : (n as Node).kind === "report" ? -260 : -80)))
      .force("collide", forceCollide<Node>().radius((n) => (n.kind === "cluster" ? 34 : n.kind === "report" ? 20 : 12)))
      .force("x", forceX(0).strength(0.04))
      .force("y", forceY(0).strength(0.06))
      .stop();
    for (let i = 0; i < 320; i += 1) sim.tick();
    const xs = nodes.map((n) => n.x ?? 0);
    const ys = nodes.map((n) => n.y ?? 0);
    const pad = 60;
    const box = { x: Math.min(...xs, 0) - pad, y: Math.min(...ys, 0) - pad, w: Math.max(...xs, 0) - Math.min(...xs, 0) + pad * 2, h: Math.max(...ys, 0) - Math.min(...ys, 0) + pad * 2 };
    return { nodes, edges, box };
  }, [data, layers]);
}

function GraphInner() {
  const params = useSearchParams();
  const router = useRouter();
  const clusterId = params.get("cluster") ?? "";
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: () => api<{ items: GraphData["clusters"] & { report_count: number }[] }>("/api/clusters") });
  const graph = useQuery({ queryKey: ["graph", clusterId], queryFn: () => api<GraphData>(`/api/graph${clusterId ? `?cluster=${clusterId}` : ""}`) });
  const [layers, setLayers] = React.useState<Set<Kind>>(new Set(["evidence", "place", "time"]));
  const layout = useLayout(graph.data, layers);
  const [selection, setSelection] = React.useState<{ type: "node"; node: Node } | { type: "edge"; edge: Edge } | null>(null);
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const drag = React.useRef<{ x: number; y: number } | null>(null);
  const [viewedCluster, setViewedCluster] = React.useState(clusterId);
  if (viewedCluster !== clusterId) {
    // Reset the view when the selected cluster changes (render-time state adjustment).
    setViewedCluster(clusterId);
    setSelection(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  const reportsById = new Map(graph.data?.reports.map((r) => [r.id, r]) ?? []);
  const vb = layout ? { w: layout.box.w / zoom, h: layout.box.h / zoom } : null;
  const viewBox = layout && vb ? `${layout.box.x + (layout.box.w - vb.w) / 2 - pan.x} ${layout.box.y + (layout.box.h - vb.h) / 2 - pan.y} ${vb.w} ${vb.h}` : "0 0 100 100";

  return (
    <div>
      <PageHeader
        title="Cross-Report Intelligence Graph"
        description="Reports become connected through scored, explainable relationships — geographic proximity, time, category, text and image similarity. Select any node or link to see why it exists."
      />
      <div className="grid gap-4 p-4 lg:p-6 xl:grid-cols-[260px_minmax(0,1fr)_340px]">
        <Panel title="Incident clusters" bodyClassName="p-0 max-h-[640px] overflow-y-auto">
          <button onClick={() => router.replace("/intelligence-graph")} className={cn("block w-full border-b border-line/60 px-4 py-2.5 text-left text-[13px] hover:bg-panel-2", !clusterId && "bg-panel-2 text-accent")}>
            All correlated reports
          </button>
          {clusters.data?.items.length === 0 && <p className="px-4 py-4 text-xs text-muted">No clusters yet. Clusters form when two or more reports meet the correlation threshold.</p>}
          {clusters.data?.items.map((c) => (
            <button key={c.id} onClick={() => router.replace(`/intelligence-graph?cluster=${c.id}`)} className={cn("block w-full border-b border-line/60 px-4 py-2.5 text-left hover:bg-panel-2", clusterId === c.id && "bg-panel-2 shadow-[inset_2px_0_0_var(--color-accent)]")}>
              <span className="flex items-center gap-2"><span className="font-mono text-[11px] text-accent">{c.reference}</span>{c.is_synthetic && <SyntheticTag />}</span>
              <span className="mt-0.5 block text-[12.5px] leading-snug">{c.title}</span>
              <span className="text-[10.5px] text-dim">{c.report_count} reports · {c.independent_source_count} independent</span>
            </button>
          ))}
        </Panel>

        <Panel
          title="Relationship graph"
          bodyClassName="p-0"
          actions={
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(z * 1.3, 5))}><ZoomIn className="size-3.5" /></Button>
              <Button size="sm" variant="ghost" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(z / 1.3, 0.4))}><ZoomOut className="size-3.5" /></Button>
              <Button size="sm" variant="ghost" aria-label="Reset view" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}><Maximize2 className="size-3.5" /></Button>
            </div>
          }
        >
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2 text-[11px] text-muted">
            {LAYERS.map((l) => (
              <label key={l.kind} className="flex items-center gap-1.5">
                <input type="checkbox" className="accent-[#9bcb8b]" checked={layers.has(l.kind)} onChange={() => setLayers((s) => { const n = new Set(s); if (n.has(l.kind)) n.delete(l.kind); else n.add(l.kind); return n; })} />
                {l.label}
              </label>
            ))}
            <span className="ml-auto hidden gap-3 md:flex">
              <span className="flex items-center gap-1"><svg width="18" height="4"><line x1="0" y1="2" x2="18" y2="2" stroke="#8fb3c9" strokeWidth="2" /></svg>corroborating</span>
              <span className="flex items-center gap-1"><svg width="18" height="4"><line x1="0" y1="2" x2="18" y2="2" stroke="#8fb3c9" strokeDasharray="5 4" strokeWidth="1.5" /></svg>related</span>
              <span className="flex items-center gap-1"><svg width="18" height="4"><line x1="0" y1="2" x2="18" y2="2" stroke="#d9a441" strokeDasharray="2 3" strokeWidth="1.5" /></svg>possible duplicate</span>
              <span className="flex items-center gap-1"><svg width="18" height="4"><line x1="0" y1="2" x2="18" y2="2" stroke="#9bcb8b" strokeWidth="2" /></svg>human-confirmed</span>
            </span>
          </div>
          <div className="relative h-[600px] overflow-hidden bg-bg grid-backdrop">
            {graph.isLoading && <Skeleton className="absolute inset-4" />}
            {graph.error && <div className="p-4"><ErrorState error={graph.error} retry={() => graph.refetch()} /></div>}
            {layout && layout.nodes.length === 0 && <EmptyState icon={<Network className="size-6" />} title="No correlated reports yet">When independent reports describe the same developing event, they appear here as a connected cluster.</EmptyState>}
            {layout && layout.nodes.length > 0 && (
              <svg
                className="size-full cursor-grab touch-none active:cursor-grabbing"
                viewBox={viewBox}
                role="img"
                aria-label="Intelligence relationship graph"
                onWheel={(e) => setZoom((z) => Math.min(5, Math.max(0.4, z * (e.deltaY < 0 ? 1.1 : 0.9))))}
                onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY }; }}
                onPointerMove={(e) => {
                  if (!drag.current || !layout) return;
                  const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
                  const scale = layout.box.w / zoom / rect.width;
                  setPan((p) => ({ x: p.x + (e.clientX - drag.current!.x) * scale, y: p.y + (e.clientY - drag.current!.y) * scale }));
                  drag.current = { x: e.clientX, y: e.clientY };
                }}
                onPointerUp={() => { drag.current = null; }}
                onPointerLeave={() => { drag.current = null; }}
              >
                {layout.edges.map((e) => {
                  const s = e.source as Node;
                  const t = e.target as Node;
                  const st = EDGE_STYLE[e.kind] ?? EDGE_STYLE.aux;
                  const sel = selection?.type === "edge" && selection.edge.id === e.id;
                  const clickable = e.id.startsWith("rel:");
                  return (
                    <g key={e.id}>
                      <line x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke={sel ? "#e8eee9" : st.stroke} strokeWidth={sel ? st.width + 1.5 : st.width} strokeDasharray={st.dash} />
                      {clickable && (
                        <line x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke="transparent" strokeWidth={12} className="cursor-pointer" onClick={(ev) => { ev.stopPropagation(); setSelection({ type: "edge", edge: e }); }} />
                      )}
                    </g>
                  );
                })}
                {layout.nodes.map((n) => {
                  const sel = selection?.type === "node" && selection.node.id === n.id;
                  const common = { className: "cursor-pointer", onClick: (ev: React.MouseEvent) => { ev.stopPropagation(); setSelection({ type: "node", node: n }); } };
                  if (n.kind === "cluster") {
                    return (
                      <g key={n.id} transform={`translate(${n.x},${n.y})`} {...common}>
                        <circle r={26} fill="#151d19" stroke="#9bcb8b" strokeWidth={sel ? 3 : 1.5} />
                        <circle r={20} fill="none" stroke="#9bcb8b" strokeOpacity={0.35} strokeDasharray="2 3" />
                        <text textAnchor="middle" dy="4" fontSize="8.5" fill="#9bcb8b" fontFamily="var(--font-mono)">{n.label.slice(-6)}</text>
                      </g>
                    );
                  }
                  if (n.kind === "report") {
                    const r = n.data as GraphData["reports"][number];
                    const ring = r.verification_status === "verified" ? "#9bcb8b" : r.verification_status === "corroborated" ? "#8fb3c9" : r.verification_status === "disputed" ? "#d9a441" : "#31423a";
                    return (
                      <g key={n.id} transform={`translate(${n.x},${n.y})`} {...common}>
                        <circle r={13} fill={SEVERITY_COLOR[r.severity ?? "NONE"]} fillOpacity={0.9} stroke={sel ? "#e8eee9" : ring} strokeWidth={sel ? 3 : 2.5} />
                        <text y={25} textAnchor="middle" fontSize="8" fill="#84918a" fontFamily="var(--font-mono)">{n.label}</text>
                      </g>
                    );
                  }
                  const shapes: Record<string, React.ReactNode> = {
                    evidence: <rect x={-6} y={-6} width={12} height={12} rx={2} fill="#1a241f" stroke={(n.data as { is_duplicate: boolean }).is_duplicate ? "#d9a441" : "#84918a"} strokeWidth={sel ? 2.5 : 1.2} />,
                    place: <polygon points="0,-8 8,0 0,8 -8,0" fill="#1a241f" stroke="#9bcb8b" strokeWidth={sel ? 2.5 : 1} />,
                    time: <rect x={-15} y={-6} width={30} height={12} rx={6} fill="#1a241f" stroke="#5d6a63" strokeWidth={sel ? 2.5 : 1} />,
                    finding: <polygon points="0,-8 7,6 -7,6" fill="#1a241f" stroke="#8fb3c9" strokeWidth={sel ? 2.5 : 1} />,
                  };
                  return (
                    <g key={n.id} transform={`translate(${n.x},${n.y})`} {...common}>
                      {shapes[n.kind]}
                      {n.kind === "time" && <text textAnchor="middle" dy="3" fontSize="6" fill="#84918a" fontFamily="var(--font-mono)">{n.label}</text>}
                      {n.kind === "place" && <text y={17} textAnchor="middle" fontSize="7" fill="#5d6a63">{n.label.length > 22 ? `${n.label.slice(0, 21)}…` : n.label}</text>}
                    </g>
                  );
                })}
              </svg>
            )}
          </div>
        </Panel>

        <Panel title="Inspector">
          {!selection && <p className="text-xs leading-relaxed text-muted">Select a report, cluster, evidence item, place, time period or relationship link to see its details. Relationship links show exactly why two reports were connected.</p>}
          {selection?.type === "edge" && (() => {
            const rel = selection.edge.data as GraphData["relationships"][number];
            const a = reportsById.get(rel.report_a);
            const b = reportsById.get(rel.report_b);
            return (
              <div className="space-y-3 text-[13px]">
                <div className="flex flex-wrap gap-1.5">
                  <Badge className="border-info/40 text-info">{humanize(rel.relationship_type)}</Badge>
                  {rel.source === "human" ? <ProvenanceTag kind="human_reviewed" /> : <ProvenanceTag kind="deterministic" />}
                  {rel.status !== "active" && <Badge className="border-line text-muted">{humanize(rel.status)}</Badge>}
                </div>
                <p className="font-mono text-xs"><Link className="text-accent hover:underline" href={`/reports/${rel.report_a}`}>{a?.reference}</Link> ↔ <Link className="text-accent hover:underline" href={`/reports/${rel.report_b}`}>{b?.reference}</Link></p>
                <p className="leading-relaxed text-fg/90">{rel.explanation}</p>
                <dl className="grid grid-cols-2 gap-2 rounded-md border border-line bg-bg-2 p-3 text-xs">
                  <dt className="text-dim">Score</dt><dd className="font-mono">{Number(rel.score).toFixed(3)}</dd>
                  <dt className="text-dim">Distance</dt><dd className="font-mono">{distance(rel.distance_m)}</dd>
                  <dt className="text-dim">Time apart</dt><dd className="font-mono">{rel.time_delta_minutes !== null ? `${Math.round(Number(rel.time_delta_minutes))} min` : "—"}</dd>
                  {rel.source === "engine" && (["geo", "temporal", "category", "semantic", "evidence"] as const).map((k) => (
                    <React.Fragment key={k}><dt className="text-dim">{humanize(k)}</dt><dd className="font-mono">{rel.components?.[k] === null || rel.components?.[k] === undefined ? "n/a" : Number(rel.components[k]).toFixed(2)}</dd></React.Fragment>
                  ))}
                </dl>
              </div>
            );
          })()}
          {selection?.type === "node" && (() => {
            const n = selection.node;
            if (n.kind === "report") {
              const r = n.data as GraphData["reports"][number];
              return (
                <div className="space-y-2.5 text-[13px]">
                  <div className="flex flex-wrap gap-1.5"><span className="font-mono text-xs text-accent">{r.reference}</span>{r.is_synthetic && <SyntheticTag />}</div>
                  <p className="font-medium">{r.title}</p>
                  <p className="text-xs text-muted">{categoryLabel(r.category)} · {r.location_text}</p>
                  <p className="text-xs text-muted">{fmtDateTime(r.occurred_at)}</p>
                  <div className="flex flex-wrap gap-2"><SeverityBadge severity={r.severity} /><VerificationBadge status={r.verification_status} /></div>
                  <Link href={`/reports/${r.id}`}><Button size="sm" variant="primary" className="mt-1">Open report</Button></Link>
                </div>
              );
            }
            if (n.kind === "cluster") {
              const c = n.data as GraphData["clusters"][number];
              return (
                <div className="space-y-2.5 text-[13px]">
                  <span className="font-mono text-xs text-accent">{c.reference}</span>
                  <p className="font-medium">{c.title}</p>
                  <p className="text-xs text-muted">{c.report_count} reports · {c.independent_source_count} independent sources</p>
                  <p className="leading-relaxed text-fg/85">{c.explanation}</p>
                </div>
              );
            }
            if (n.kind === "evidence") {
              const e = n.data as GraphData["evidence"][number];
              return <div className="space-y-2 text-[13px]"><p>Evidence · {e.file_kind}</p><p className="text-xs text-muted">AI relevance: {humanize(e.ai_relevance ?? "not analysed")}</p>{e.is_duplicate && <p className="text-xs text-warn">Duplicate of previously submitted imagery ({e.duplicate_kind}).</p>}<p className="text-[11px] text-dim">Relevance is not proof of authenticity.</p></div>;
            }
            if (n.kind === "finding") {
              const f = n.data as GraphData["findings"][number];
              return <div className="space-y-2 text-[13px]"><ProvenanceTag kind="ai_assessment" /><p>Investigation {humanize(f.status)}</p><div className="flex gap-2"><SeverityBadge severity={f.severity} /><ConfidenceMeter value={f.confidence} /></div><Link href={`/investigations/${f.id}`} className="text-xs text-accent hover:underline">Open investigation →</Link></div>;
            }
            const d = n.data as Record<string, unknown>;
            return <div className="space-y-1 text-[13px]"><p className="font-medium">{n.kind === "place" ? String(d.place) : String(d.period)}</p><p className="text-xs text-muted">{String(d.reports)} report(s) connected</p></div>;
          })()}
        </Panel>
      </div>
    </div>
  );
}

export default function GraphPage() {
  return (
    <React.Suspense fallback={<div className="p-6"><Skeleton className="h-96" /></div>}>
      <GraphInner />
    </React.Suspense>
  );
}
