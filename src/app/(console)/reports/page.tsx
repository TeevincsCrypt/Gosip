"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { FileSearch, Paperclip, Search } from "lucide-react";
import { api, timeAgo } from "@/lib/client/utils";
import { CATEGORIES, SEVERITIES, VERIFICATION_STATUSES } from "@/lib/domain/constants";
import type { PublicReport } from "@/lib/domain/types";
import { PageHeader } from "@/components/app/shell";
import { EmptyState, ErrorState, Input, Panel, Select, Skeleton } from "@/components/ui/primitives";
import { CategoryTag, ConfidenceMeter, InvestigationBadge, SeverityBadge, SyntheticTag, VerificationBadge } from "@/components/ui/badges";
import { Button } from "@/components/ui/primitives";

function ReportsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [q, setQ] = React.useState(params.get("q") ?? "");
  const category = params.get("category") ?? "";
  const severity = params.get("severity") ?? "";
  const verification = params.get("verification") ?? "";

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    router.replace(`/reports?${next.toString()}`);
  };

  const qs = new URLSearchParams();
  if (category) qs.set("category", category);
  if (severity) qs.set("severity", severity);
  if (verification) qs.set("verification", verification);
  if (params.get("q")) qs.set("q", params.get("q")!);
  if (params.get("cluster")) qs.set("cluster", params.get("cluster")!);

  const query = useQuery({
    queryKey: ["reports", qs.toString()],
    queryFn: () => api<{ items: PublicReport[]; total: number }>(`/api/reports?${qs.toString()}&limit=200`),
  });

  return (
    <div>
      <PageHeader
        title="Incident Reports"
        description="Community-submitted reports. Each is a claim until independently corroborated or human-reviewed; badges show where each report stands."
        actions={
          <Link href="/report">
            <Button variant="primary">New report</Button>
          </Link>
        }
      />
      <div className="space-y-4 p-4 lg:p-6">
        <div className="grid gap-2 md:grid-cols-[1fr_180px_160px_170px]">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setParam("q", q.trim());
            }}
            className="relative"
          >
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-dim" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, description, location or reference" className="pl-9" aria-label="Search reports" />
          </form>
          <Select value={category} onChange={(e) => setParam("category", e.target.value)} aria-label="Category filter">
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
          <Select value={severity} onChange={(e) => setParam("severity", e.target.value)} aria-label="Severity filter">
            <option value="">All severities</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            <option value="HIGH,CRITICAL">HIGH + CRITICAL</option>
          </Select>
          <Select value={verification} onChange={(e) => setParam("verification", e.target.value)} aria-label="Verification filter">
            <option value="">All statuses</option>
            {VERIFICATION_STATUSES.filter((s) => s !== "rejected").map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </div>
        {params.get("cluster") && (
          <p className="text-xs text-muted">
            Showing reports in one incident cluster. <button className="text-accent hover:underline" onClick={() => setParam("cluster", "")}>Clear</button>
          </p>
        )}

        <Panel title={query.data ? `${query.data.total} report(s)` : "Reports"} bodyClassName="p-0">
          {query.isLoading && <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>}
          {query.error && <div className="p-4"><ErrorState error={query.error} retry={() => query.refetch()} /></div>}
          {query.data?.items.length === 0 && (
            <EmptyState icon={<FileSearch className="size-6" />} title="No reports match these filters" action={<Link href="/report"><Button size="sm" variant="outline">Submit a report</Button></Link>}>
              Try clearing filters or searching a different term.
            </EmptyState>
          )}
          <ul className="divide-y divide-line/60">
            {query.data?.items.map((r) => (
              <li key={r.id}>
                <Link href={`/reports/${r.id}`} className="grid gap-2 px-4 py-3 hover:bg-panel-2 md:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] text-dim">{r.reference}</span>
                      <CategoryTag category={r.category} />
                      {r.is_synthetic && <SyntheticTag />}
                      {r.is_anonymous && <span className="text-[10px] uppercase tracking-wider text-dim">anonymous</span>}
                      {r.evidence_count > 0 && <span className="flex items-center gap-0.5 text-[11px] text-dim"><Paperclip className="size-3" />{r.evidence_count}</span>}
                    </div>
                    <p className="mt-1 truncate text-[14px] text-fg">{r.title}</p>
                    <p className="truncate text-[12px] text-muted">{r.location_text} · {timeAgo(r.occurred_at)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 md:justify-end">
                    <SeverityBadge severity={r.severity} />
                    <ConfidenceMeter value={r.confidence} />
                    <VerificationBadge status={r.verification_status} />
                    <InvestigationBadge status={r.investigation_status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  return (
    <React.Suspense fallback={<div className="p-6"><Skeleton className="h-40" /></div>}>
      <ReportsInner />
    </React.Suspense>
  );
}
