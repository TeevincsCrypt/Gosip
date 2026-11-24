"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowLeft, Check, Download, FileImage, GitMerge, Link2, Lock, MapPin, Network, RefreshCw, ShieldCheck, Waypoints, X,
} from "lucide-react";
import { api, cn, distance, fmtDateTime, humanize, timeAgo } from "@/lib/client/utils";
import { AGENTS, AI_DISCLAIMER, categoryLabel, type Provenance } from "@/lib/domain/constants";
import type { AgentFindingRow, PublicReport } from "@/lib/domain/types";
import { useSession } from "@/components/app/providers";
import { AgentPipeline, IncompleteNotice } from "@/components/app/agent-pipeline";
import { FindingView } from "@/components/app/finding-view";
import { IncidentMap } from "@/components/app/incident-map";
import { Button, EmptyState, ErrorState, Input, Mono, Panel, Skeleton, Textarea } from "@/components/ui/primitives";
import {
  Badge, CategoryTag, ConfidenceMeter, InvestigationBadge, ProvenanceTag, SeverityBadge, SyntheticTag, VerificationBadge,
} from "@/components/ui/badges";

type Lead = {
  executive_summary: string;
  incident_classification: { category: string; rationale: string };
  severity: { level: string; rationale: string };
  evidence_assessment: string;
  corroboration_findings: string;
  geographic_consistency: string;
  confidence: { score: number; level: string; rationale: string };
  key_findings: { statement: string; basis: Provenance; refs: string[] }[];
  conflicting_evidence: { description: string; refs: string[] }[];
  unresolved_questions: string[];
  recommended_next_steps: { action: string; owner: string; priority: string }[];
  review_reasons?: string[];
};

interface Detail {
  report: PublicReport;
  staff: Record<string, unknown> | null;
  isOwnReport: boolean;
  evidence: Record<string, unknown>[];
  investigation: (Record<string, unknown> & { id: string; status: string; summary: Lead | null; model: string | null; started_at: string | null; completed_at: string | null; attempt: number; error?: string | null }) | null;
  investigationHistory: { id: string; status: string; trigger: string; created_at: string }[];
  findings: AgentFindingRow[];
  relationships: (Record<string, unknown> & { id: string; other_id: string; other_reference: string; other_title: string; other_category: string; relationship_type: string; score: number; explanation: string; components: Record<string, unknown>; status: string; source: string; distance_m: number | null; time_delta_minutes: number | null; other_verification: string })[];
  cluster: { id: string; reference: string; title: string; report_count: number; independent_source_count: number; explanation: string; latitude: number; longitude: number; radius_m: number } | null;
  timeline: { id: number; event_type: string; actor_type: string; summary: string; created_at: string; visibility: string }[];
  reviews: { id: string; decision: string; notes: string | null; created_at: string; reviewer_name: string }[];
  viewer: { staff: boolean; role: string };
}

const REF_LABEL = (ref: string) => {
  const [kind, id] = ref.split(":");
  const agent = AGENTS.find((a) => a.id === kind);
  if (agent) return `Agent ${agent.code}${id ? ` · ${id.slice(0, 10)}` : ""}`;
  return ref;
};

function useReview(reportId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ summary: string }>("/api/admin/review", { method: "POST", body: JSON.stringify({ reportId, ...body }) }),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isStaff } = useSession();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["report", id],
    queryFn: () => api<Detail>(`/api/reports/${id}`),
    refetchInterval: (query) => (["queued", "running"].includes(query.state.data?.report.investigation_status ?? "") ? 2500 : false),
  });
  const [agent, setAgent] = React.useState<string | null>("lead");
  const retry = useMutation({
    mutationFn: () => api("/api/investigations", { method: "POST", body: JSON.stringify({ reportId: id }) }),
    onSuccess: () => qc.invalidateQueries(),
  });

  if (q.isLoading) return <div className="space-y-3 p-6"><Skeleton className="h-16" /><Skeleton className="h-64" /><Skeleton className="h-64" /></div>;
  if (q.error || !q.data) return <div className="p-6"><ErrorState error={q.error ?? new Error("Report not found")} retry={() => q.refetch()} /></div>;

  const d = q.data;
  const r = d.report;
  const lead = d.investigation?.summary ?? null;
  const selectedFinding = d.findings.find((f) => f.agent === agent);

  return (
    <div>
      <div className="border-b border-line px-4 py-4 lg:px-6">
        <Link href="/reports" className="mb-2 inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
          <ArrowLeft className="size-3" /> Reports
        </Link>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Mono className="text-accent">{r.reference}</Mono>
              <CategoryTag category={r.category} />
              <VerificationBadge status={r.verification_status} />
              <InvestigationBadge status={r.investigation_status} />
              {r.priority_escalated && <Badge className="border-danger/50 bg-danger/15 text-danger">Escalated</Badge>}
              {r.lifecycle_status === "resolved" && <Badge className="border-accent/40 text-accent">Resolved</Badge>}
              {r.is_synthetic && <SyntheticTag />}
              {r.is_sensitive && <Badge className="border-warn/40 text-warn" title="Sensitive category: location coarsened and findings restricted for the public"><Lock className="size-3" />Sensitive</Badge>}
            </div>
            <h1 className="mt-2 text-xl font-semibold leading-snug">{r.title}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              <span className="flex items-center gap-1"><MapPin className="size-3" />{r.location_text}</span>
              <span>Occurred {fmtDateTime(r.occurred_at)}</span>
              <span>Submitted {timeAgo(r.submitted_at)}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {d.cluster && (
              <Link href={`/intelligence-graph?cluster=${d.cluster.id}`}><Button size="sm" variant="outline"><Network className="size-3.5" /> Graph</Button></Link>
            )}
            <Link href={`/map?report=${r.id}`}><Button size="sm" variant="outline"><MapPin className="size-3.5" /> Map</Button></Link>
            <a href={`/api/reports/${r.id}/pdf`}><Button size="sm" variant="outline"><Download className="size-3.5" /> Export PDF</Button></a>
            {isStaff && (
              <Button size="sm" variant="secondary" loading={retry.isPending} onClick={() => retry.mutate()} disabled={["queued", "running"].includes(r.investigation_status)}>
                <RefreshCw className="size-3.5" /> {d.investigation ? "Re-run investigation" : "Run investigation"}
              </Button>
            )}
          </div>
        </div>
        {retry.error && <p className="mt-2 text-xs text-danger">{(retry.error as Error).message}</p>}
      </div>

      <div className="grid gap-4 p-4 lg:p-6 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {/* Severity vs confidence */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-line bg-panel p-3">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">Potential severity</p>
              <div className="mt-2"><SeverityBadge severity={r.severity} /></div>
              <p className="mt-2 text-[11px] text-dim">Impact if accurate · AI assessment</p>
            </div>
            <div className="rounded-lg border border-line bg-panel p-3">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">Confidence</p>
              <div className="mt-2"><ConfidenceMeter value={r.confidence} /></div>
              <p className="mt-2 text-[11px] text-dim">{lead ? humanize(lead.confidence.level) : "Not assessed"} · independent of severity</p>
            </div>
            <div className="rounded-lg border border-line bg-panel p-3">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">Human review</p>
              <p className={cn("mt-2 text-sm", r.verification_status === "verified" ? "text-accent" : r.needs_human_review ? "text-warn" : "text-muted")}>
                {r.verification_status === "verified" ? "Verified by reviewer" : r.verification_status === "rejected" ? "Rejected" : r.verification_status === "disputed" ? "Disputed" : r.needs_human_review ? "Awaiting review" : "Not requested"}
              </p>
              <p className="mt-2 text-[11px] text-dim">Only humans can verify or resolve</p>
            </div>
          </div>

          <Panel title="Original report" actions={<ProvenanceTag kind="user_claim" />}>
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-fg/90">{r.description}</p>
            <dl className="mt-4 grid gap-3 border-t border-line pt-3 text-xs sm:grid-cols-4">
              <div><dt className="text-dim">Submitter</dt><dd className="mt-0.5">{r.is_anonymous ? "Anonymous" : r.is_registered_reporter ? "Registered account" : "Unregistered"}</dd></div>
              <div><dt className="text-dim">Coordinates</dt><dd className="mt-0.5 font-mono">{r.latitude !== null ? `${r.latitude}, ${r.longitude}` : "Not provided"}</dd></div>
              <div><dt className="text-dim">Precision</dt><dd className="mt-0.5">{humanize(r.location_precision)}{r.location_precision === "approximate" && " (protected)"}</dd></div>
              <div><dt className="text-dim">Location source</dt><dd className="mt-0.5">{humanize(r.location_source)}</dd></div>
            </dl>
            {d.staff && (
              <div className="mt-3 rounded-md border border-line bg-bg-2 p-3 text-xs">
                <p className="mb-1.5 flex items-center gap-1 font-semibold uppercase tracking-[0.1em] text-warn"><Lock className="size-3" /> {d.viewer.staff ? "Restricted · reviewers only" : "Visible only to you"}</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <div><span className="text-dim">Contact name</span><p>{String(d.staff.contact_name ?? "—")}</p></div>
                  <div><span className="text-dim">Phone</span><p>{String(d.staff.contact_phone ?? "—")}</p></div>
                  <div><span className="text-dim">Email</span><p>{String(d.staff.contact_email ?? "—")}</p></div>
                  {d.viewer.staff && <div className="sm:col-span-3"><span className="text-dim">Exact coordinates</span><p className="font-mono">{d.staff.exact_latitude != null ? `${Number(d.staff.exact_latitude).toFixed(6)}, ${Number(d.staff.exact_longitude).toFixed(6)}` : "—"}</p></div>}
                </div>
              </div>
            )}
          </Panel>

          <Panel
            title="Intelligence assessment"
            subtitle={d.investigation ? `Investigation attempt ${d.investigation.attempt}${d.investigation.model ? ` · ${d.investigation.model}` : ""}${d.investigation.completed_at ? ` · completed ${timeAgo(d.investigation.completed_at)}` : ""}` : undefined}
            actions={<ProvenanceTag kind="ai_assessment" />}
          >
            <div className="space-y-4">
              {d.investigation && <IncompleteNotice status={d.investigation.status} />}
              {!d.investigation && <EmptyState title="No investigation yet">{r.investigation_status === "queued" ? "The investigation is queued and will start shortly." : "An investigation will run automatically when AI is configured."}</EmptyState>}
              {d.investigation && ["queued", "running"].includes(d.investigation.status) && (
                <p className="flex items-center gap-2 text-sm text-accent"><span className="size-2 animate-pulse rounded-full bg-accent" /> Agents are working. This view updates automatically.</p>
              )}
              {r.is_sensitive && !d.viewer.staff && d.investigation && (
                <p className="rounded-md border border-line bg-bg-2 p-3 text-xs text-muted">Detailed findings for sensitive (violence/security) reports are restricted to authorised reviewers.</p>
              )}
              {lead && (
                <>
                  <p className="text-[14px] leading-relaxed">{lead.executive_summary}</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-md border border-line bg-bg-2 p-3">
                      <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-dim">Severity rationale</p>
                      <p className="mt-1 text-[13px] leading-relaxed">{lead.severity.rationale}</p>
                    </div>
                    <div className="rounded-md border border-line bg-bg-2 p-3">
                      <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-dim">Confidence rationale</p>
                      <p className="mt-1 text-[13px] leading-relaxed">{lead.confidence.rationale}</p>
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">Key findings · traceable to sources</p>
                    <ul className="space-y-2">
                      {lead.key_findings.map((k, i) => (
                        <li key={i} className="rounded-md border border-line bg-bg-2 p-2.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <ProvenanceTag kind={k.basis} />
                            {k.refs.map((ref) => <Badge key={ref} className="border-line text-dim normal-case tracking-normal">{REF_LABEL(ref)}</Badge>)}
                          </div>
                          <p className="mt-1.5 text-[13px] leading-relaxed">{k.statement}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div><p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-dim">Evidence</p><p className="mt-1 text-[13px] leading-relaxed">{lead.evidence_assessment}</p></div>
                    <div><p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-dim">Corroboration</p><p className="mt-1 text-[13px] leading-relaxed">{lead.corroboration_findings}</p></div>
                    <div><p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-dim">Geography</p><p className="mt-1 text-[13px] leading-relaxed">{lead.geographic_consistency}</p></div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <p className="mb-1 flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-warn"><AlertTriangle className="size-3" /> Conflicting evidence</p>
                      {lead.conflicting_evidence.length ? <ul className="list-disc space-y-1 pl-4 text-[13px]">{lead.conflicting_evidence.map((c, i) => <li key={i}>{c.description}</li>)}</ul> : <p className="text-xs text-dim">None identified.</p>}
                    </div>
                    <div>
                      <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-dim">Unresolved questions</p>
                      {lead.unresolved_questions.length ? <ul className="list-disc space-y-1 pl-4 text-[13px]">{lead.unresolved_questions.map((c, i) => <li key={i}>{c}</li>)}</ul> : <p className="text-xs text-dim">None.</p>}
                    </div>
                    <div>
                      <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-dim">Recommended next steps</p>
                      <ul className="space-y-1.5 text-[13px]">
                        {lead.recommended_next_steps.map((s, i) => (
                          <li key={i} className="flex gap-2"><Badge className={cn("shrink-0", s.priority === "now" ? "border-danger/40 text-danger" : "border-line text-muted")}>{s.priority}</Badge><span>{s.action} <span className="text-dim">· {humanize(s.owner)}</span></span></li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  {lead.review_reasons && lead.review_reasons.length > 0 && (
                    <p className="text-xs text-warn">Human review requested: {lead.review_reasons.join("; ")}</p>
                  )}
                </>
              )}
              <p className="border-t border-line pt-3 text-[11px] text-dim">{AI_DISCLAIMER}</p>
            </div>
          </Panel>

          <Panel title="Investigation pipeline" subtitle="Six specialised agents. Select an agent to inspect its structured findings.">
            {d.findings.length === 0 ? (
              <EmptyState title="No agent runs recorded">{d.investigation?.status === "not_configured" ? "The AI provider is not configured on this deployment." : "Agents run after submission."}</EmptyState>
            ) : (
              <div className="space-y-4">
                <AgentPipeline findings={d.findings} selected={agent} onSelect={setAgent} />
                {selectedFinding && (
                  <div className="rounded-md border border-line bg-bg p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">{AGENTS.find((a) => a.id === selectedFinding.agent)?.name}</p>
                      <div className="flex gap-1.5">
                        {selectedFinding.output && <ProvenanceTag kind="ai_assessment" />}
                        {selectedFinding.deterministic && <ProvenanceTag kind="deterministic" />}
                      </div>
                    </div>
                    {(selectedFinding.error || selectedFinding.error_summary) && (
                      <p className="mb-3 rounded-md border border-danger/30 bg-danger/5 p-2 font-mono text-[11.5px] text-danger">
                        {selectedFinding.status === "skipped" ? "Skipped: " : ""}{selectedFinding.error ?? selectedFinding.error_summary}
                      </p>
                    )}
                    {selectedFinding.output ? <FindingView value={selectedFinding.output} /> : !selectedFinding.error && <p className="text-xs text-dim">{r.is_sensitive && !d.viewer.staff ? "Restricted." : "No AI output."}</p>}
                    {selectedFinding.deterministic && (
                      <details className="mt-4 rounded-md border border-line p-3">
                        <summary className="cursor-pointer text-xs text-muted">Deterministic platform checks used as input</summary>
                        <div className="mt-3"><FindingView value={selectedFinding.deterministic} /></div>
                      </details>
                    )}
                  </div>
                )}
              </div>
            )}
          </Panel>

          <EvidencePanel d={d} />
          <RelationshipsPanel d={d} />
        </div>

        <div className="space-y-4">
          {r.latitude !== null && (
            <Panel title="Location" bodyClassName="p-0">
              <IncidentMap
                className="h-64"
                reports={[r as never, ...[]]}
                clusters={d.cluster ? [d.cluster] : []}
                selectedId={r.id}
              />
            </Panel>
          )}
          {d.cluster && (
            <Panel title="Incident cluster" actions={<Waypoints className="size-4 text-accent" />}>
              <p className="font-mono text-xs text-accent">{d.cluster.reference}</p>
              <p className="mt-1 text-sm">{d.cluster.title}</p>
              <p className="mt-1 text-xs text-muted">{d.cluster.report_count} reports · {d.cluster.independent_source_count} independent sources</p>
              <p className="mt-2 text-[12px] leading-relaxed text-fg/80">{d.cluster.explanation}</p>
              <div className="mt-3 flex gap-2">
                <Link href={`/intelligence-graph?cluster=${d.cluster.id}`}><Button size="sm" variant="outline">Open graph</Button></Link>
                <Link href={`/reports?cluster=${d.cluster.id}`}><Button size="sm" variant="ghost">List reports</Button></Link>
              </div>
            </Panel>
          )}
          {isStaff && <ReviewPanel d={d} />}
          <Panel title="Timeline" bodyClassName="max-h-[520px] overflow-y-auto">
            <ol className="relative space-y-3 border-l border-line pl-4">
              {d.timeline.map((e) => (
                <li key={e.id} className="relative">
                  <span className={cn("absolute -left-[21px] top-1 size-2.5 rounded-full border-2 border-bg", e.actor_type === "reviewer" ? "bg-accent" : e.actor_type === "agent" ? "bg-info" : e.actor_type === "user" ? "bg-fg" : "bg-dim")} />
                  <p className="text-[12.5px] leading-snug">{e.summary}</p>
                  <p className="mt-0.5 text-[10.5px] text-dim">{fmtDateTime(e.created_at)} · {e.actor_type}{e.visibility === "staff" ? " · staff only" : ""}</p>
                </li>
              ))}
            </ol>
          </Panel>
          {d.reviews.length > 0 && (
            <Panel title="Human review history" actions={<ProvenanceTag kind="human_reviewed" />}>
              <ul className="space-y-2">
                {d.reviews.map((rv) => (
                  <li key={rv.id} className="text-xs">
                    <span className="font-medium text-accent">{humanize(rv.decision)}</span> by {rv.reviewer_name} · <span className="text-dim">{timeAgo(rv.created_at)}</span>
                    {rv.notes && <p className="mt-0.5 text-muted">“{rv.notes}”</p>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function EvidencePanel({ d }: { d: Detail }) {
  const review = useReview(d.report.id);
  const staff = d.viewer.staff;
  return (
    <Panel title={`Evidence (${d.evidence.length})`} subtitle="Visual relevance is not proof of authenticity. Metadata is a signal, never proof.">
      {d.evidence.length === 0 && <EmptyState icon={<FileImage className="size-5" />} title="No evidence submitted" />}
      <div className="grid gap-3 md:grid-cols-2">
        {d.evidence.map((e) => {
          const ev = e as Record<string, unknown> & { id: string; file_kind: string; metadata_flags: string[]; ai_relevance: string | null; duplicate_kind: string | null; review_status: string };
          const analysis = (ev.ai_analysis as Record<string, unknown> | null) ?? null;
          const summary = (analysis?.visible_summary as string) ?? (ev.visible_summary as string) ?? null;
          return (
            <div key={ev.id} className="overflow-hidden rounded-md border border-line bg-bg-2">
              {staff && ev.file_kind === "image" ? (
                <a href={`/api/evidence/${ev.id}/file`} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- private, authorised, uncached evidence route */}
                  <img src={`/api/evidence/${ev.id}/file`} alt="Submitted evidence" className="h-44 w-full object-cover" loading="lazy" />
                </a>
              ) : (
                <div className="grid h-24 place-items-center text-xs text-dim">
                  <span className="flex items-center gap-1.5"><Lock className="size-3.5" /> {staff ? `${humanize(ev.file_kind)} file` : "Files visible to authorised reviewers only"}</span>
                </div>
              )}
              <div className="space-y-2 p-3 text-xs">
                <div className="flex flex-wrap gap-1.5">
                  <Badge className={cn(ev.ai_relevance === "relevant" ? "border-accent/40 text-accent" : ev.ai_relevance === "unrelated" ? "border-danger/40 text-danger" : "border-line text-muted")}>
                    {ev.ai_relevance ? `Relevance: ${humanize(ev.ai_relevance)}` : "Not analysed"}
                  </Badge>
                  {Boolean(ev.duplicate_kind || ev.is_duplicate) && <Badge className="border-warn/40 text-warn">{ev.duplicate_kind === "exact" ? "Identical file seen before" : "Near-duplicate image"}</Badge>}
                  {ev.metadata_flags?.map((f) => <Badge key={f} className="border-line normal-case tracking-normal text-muted">{humanize(f)}</Badge>)}
                  <Badge className="border-line text-dim">Review: {ev.review_status}</Badge>
                </div>
                {summary && <p className="leading-relaxed text-fg/85">{summary}</p>}
                {analysis && (
                  <details>
                    <summary className="cursor-pointer text-muted">Full evidence analysis</summary>
                    <div className="mt-2"><FindingView value={analysis} /></div>
                  </details>
                )}
                {staff && (
                  <>
                    <p className="break-all font-mono text-[10px] text-dim">sha256 {String(ev.sha256 ?? "")}<br />dHash {String(ev.phash ?? "—")}</p>
                    {Array.isArray((ev.metadata as { notes?: string[] })?.notes) && (ev.metadata as { notes: string[] }).notes.map((n, i) => <p key={i} className="text-[11px] text-muted">• {n}</p>)}
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => review.mutate({ action: "accept_evidence", evidenceId: ev.id })}><Check className="size-3" />Accept</Button>
                      <Button size="sm" variant="ghost" onClick={() => review.mutate({ action: "reject_evidence", evidenceId: ev.id })}><X className="size-3" />Reject</Button>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function RelationshipsPanel({ d }: { d: Detail }) {
  const review = useReview(d.report.id);
  return (
    <Panel title={`Related reports (${d.relationships.length})`} subtitle="Links are computed from distance, time, category, text and image similarity. Each explains itself.">
      {d.relationships.length === 0 && <EmptyState icon={<Link2 className="size-5" />} title="No related reports found">No other report falls within the correlation radius, time window and score threshold.</EmptyState>}
      <ul className="space-y-2">
        {d.relationships.map((rel) => {
          const c = rel.components as Record<string, number | null>;
          return (
            <li key={rel.id} className={cn("rounded-md border bg-bg-2 p-3", rel.status === "rejected_by_reviewer" ? "border-line opacity-60" : "border-line")}>
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/reports/${rel.other_id}`} className="font-mono text-xs text-accent hover:underline">{rel.other_reference}</Link>
                <Badge className={cn(rel.relationship_type === "corroborating" ? "border-info/40 text-info" : rel.relationship_type === "possible_duplicate" ? "border-warn/40 text-warn" : "border-line text-muted")}>{humanize(rel.relationship_type)}</Badge>
                <span className="font-mono text-[11px] text-muted">score {Number(rel.score).toFixed(2)}</span>
                {rel.source === "human" && <ProvenanceTag kind="human_reviewed" />}
                {rel.status !== "active" && <Badge className="border-line text-muted">{humanize(rel.status)}</Badge>}
                <span className="text-[11px] text-dim">{distance(rel.distance_m)} · {rel.time_delta_minutes !== null ? `${Math.round(Number(rel.time_delta_minutes))} min apart` : ""}</span>
              </div>
              <p className="mt-1 text-[13px]">{rel.other_title} <span className="text-dim">· {categoryLabel(rel.other_category)}</span></p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{rel.explanation}</p>
              {rel.source === "engine" && (
                <div className="mt-2 flex flex-wrap gap-3 font-mono text-[10.5px] text-dim">
                  {(["geo", "temporal", "category", "semantic", "evidence"] as const).map((k) => (
                    <span key={k}>{k} {c?.[k] === null || c?.[k] === undefined ? "n/a" : Number(c[k]).toFixed(2)}</span>
                  ))}
                </div>
              )}
              {d.viewer.staff && (
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => review.mutate({ action: "confirm_relationship", relationshipId: rel.id })}><Check className="size-3" />Confirm link</Button>
                  <Button size="sm" variant="ghost" onClick={() => review.mutate({ action: "reject_relationship", relationshipId: rel.id })}><X className="size-3" />Reject link</Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function ReviewPanel({ d }: { d: Detail }) {
  const review = useReview(d.report.id);
  const [notes, setNotes] = React.useState("");
  const [mergeRef, setMergeRef] = React.useState("");
  const [mergeError, setMergeError] = React.useState<string | null>(null);
  const r = d.report;
  const act = (action: string, extra: Record<string, unknown> = {}) =>
    review.mutate({ action, notes: notes || undefined, ...extra }, { onSuccess: () => setNotes("") });

  async function merge() {
    setMergeError(null);
    const res = await api<{ items: PublicReport[] }>(`/api/reports?q=${encodeURIComponent(mergeRef.trim())}&limit=5`);
    const target = res.items.find((x) => x.reference.toUpperCase() === mergeRef.trim().toUpperCase());
    if (!target) return setMergeError("No report with that reference.");
    act("merge", { targetReportId: target.id });
    setMergeRef("");
  }

  return (
    <Panel title="Human review" actions={<ShieldCheck className="size-4 text-accent" />}>
      <div className="space-y-3">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Investigation notes / reason for decision (recorded in the audit trail)" className="min-h-20 text-xs" />
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" variant="primary" disabled={r.verification_status === "verified"} onClick={() => act("verify")}>Verify</Button>
          <Button size="sm" variant="outline" disabled={r.verification_status === "disputed"} onClick={() => act("dispute")}>Mark disputed</Button>
          <Button size="sm" variant="danger" disabled={r.verification_status === "rejected"} onClick={() => act("reject")}>Reject</Button>
          {r.priority_escalated ? (
            <Button size="sm" variant="outline" onClick={() => act("deescalate")}>De-escalate</Button>
          ) : (
            <Button size="sm" variant="danger" onClick={() => act("escalate")}>Escalate</Button>
          )}
          {r.lifecycle_status === "resolved" ? (
            <Button size="sm" variant="outline" onClick={() => act("reopen")}>Reopen</Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => act("resolve")}>Mark resolved</Button>
          )}
          <Button size="sm" variant="ghost" disabled={!notes.trim()} onClick={() => act("note")}>Add note</Button>
        </div>
        {d.cluster && (
          <Button size="sm" variant="ghost" className="w-full" onClick={() => act("separate", { clusterId: d.cluster!.id })}>
            Separate from cluster {d.cluster.reference}
          </Button>
        )}
        <div className="flex gap-2">
          <Input value={mergeRef} onChange={(e) => setMergeRef(e.target.value)} placeholder="Link with report ref (GSP-…)" className="h-8 text-xs" />
          <Button size="sm" variant="outline" disabled={!mergeRef.trim()} onClick={merge}><GitMerge className="size-3" />Link</Button>
        </div>
        {mergeError && <p className="text-xs text-danger">{mergeError}</p>}
        {review.error && <p className="text-xs text-danger">{(review.error as Error).message}</p>}
        {review.data && <p className="text-xs text-accent">{review.data.summary}</p>}
        <p className="text-[11px] text-dim">Every decision is recorded with your identity, the previous and new state, and your notes.</p>
      </div>
    </Panel>
  );
}
