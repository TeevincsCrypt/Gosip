"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { FileImage, Copy } from "lucide-react";
import { api, cn, humanize, timeAgo } from "@/lib/client/utils";
import { PageHeader } from "@/components/app/shell";
import { RequireStaff } from "@/components/app/require-role";
import { EmptyState, ErrorState, Panel, Select, Skeleton } from "@/components/ui/primitives";
import { Badge, SyntheticTag } from "@/components/ui/badges";

interface Row {
  id: string; report_id: string; original_filename: string; mime_type: string; file_kind: string; size_bytes: number; sha256: string; phash: string | null;
  width: number | null; height: number | null; metadata: { notes?: string[]; camera_make?: string | null; camera_model?: string | null; captured_at?: string | null; has_gps?: boolean };
  metadata_flags: string[]; ai_relevance: string | null; visible_summary: string | null; duplicate_of: string | null; duplicate_kind: string | null; duplicate_distance: number | null;
  review_status: string; uploaded_at: string; reference: string; title: string; is_synthetic: boolean; is_sensitive: boolean;
}

function EvidenceInner() {
  const q = useQuery({ queryKey: ["evidence"], queryFn: () => api<{ items: Row[] }>("/api/evidence") });
  const [filter, setFilter] = React.useState("all");
  const items = (q.data?.items ?? []).filter((e) =>
    filter === "all" ? true : filter === "duplicates" ? e.duplicate_of : filter === "flagged" ? e.metadata_flags.length > 0 : filter === "unrelated" ? e.ai_relevance === "unrelated" : filter === "pending" ? e.review_status === "pending" : true,
  );
  const counts = {
    total: q.data?.items.length ?? 0,
    duplicates: q.data?.items.filter((e) => e.duplicate_of).length ?? 0,
    flagged: q.data?.items.filter((e) => e.metadata_flags.length).length ?? 0,
    pending: q.data?.items.filter((e) => e.review_status === "pending").length ?? 0,
  };
  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Object.entries(counts).map(([k, v]) => (
          <div key={k} className="rounded-lg border border-line bg-panel px-4 py-3"><p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{humanize(k)}</p><p className="mt-1 font-mono text-2xl">{v}</p></div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-56" aria-label="Filter evidence">
          <option value="all">All evidence</option>
          <option value="duplicates">Duplicate / near-duplicate</option>
          <option value="flagged">Metadata flags</option>
          <option value="unrelated">AI: unrelated to report</option>
          <option value="pending">Pending human review</option>
        </Select>
      </div>
      {q.isLoading && <Skeleton className="h-64" />}
      {q.error && <ErrorState error={q.error} retry={() => q.refetch()} />}
      {q.data && items.length === 0 && <Panel><EmptyState icon={<FileImage className="size-6" />} title="No evidence matches">Evidence appears here when reporters attach photos or videos.</EmptyState></Panel>}
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {items.map((e) => (
          <div key={e.id} className="overflow-hidden rounded-lg border border-line bg-panel">
            <div className="grid grid-cols-[140px_1fr]">
              {e.file_kind === "image" ? (
                <a href={`/api/evidence/${e.id}/file`} target="_blank" rel="noreferrer" className="block bg-bg-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- private, authorised, uncached evidence route */}
                  <img src={`/api/evidence/${e.id}/file`} alt="Evidence" className="h-full max-h-48 w-full object-cover" loading="lazy" /></a>
              ) : (
                <div className="grid place-items-center bg-bg-2 text-xs text-dim">{humanize(e.file_kind)}</div>
              )}
              <div className="min-w-0 space-y-1.5 p-3 text-xs">
                <div className="flex flex-wrap items-center gap-1.5"><Link href={`/reports/${e.report_id}`} className="font-mono text-accent hover:underline">{e.reference}</Link>{e.is_synthetic && <SyntheticTag />}{e.is_sensitive && <Badge className="border-warn/40 text-warn">Sensitive</Badge>}</div>
                <p className="truncate text-[12.5px] text-fg">{e.title}</p>
                <p className="truncate text-dim">{e.original_filename} · {(e.size_bytes / 1024).toFixed(0)} KB{e.width ? ` · ${e.width}×${e.height}` : ""} · {timeAgo(e.uploaded_at)}</p>
                <div className="flex flex-wrap gap-1">
                  <Badge className={cn(e.ai_relevance === "relevant" ? "border-accent/40 text-accent" : e.ai_relevance === "unrelated" ? "border-danger/40 text-danger" : "border-line text-muted")}>{e.ai_relevance ? humanize(e.ai_relevance) : "Not analysed"}</Badge>
                  {e.duplicate_of && <Badge className="border-warn/40 text-warn"><Copy className="size-3" />{e.duplicate_kind === "exact" ? "Identical" : `Near-dup (d=${e.duplicate_distance})`}</Badge>}
                  {e.metadata_flags.map((f) => <Badge key={f} className="border-line normal-case tracking-normal text-muted">{humanize(f)}</Badge>)}
                  <Badge className="border-line text-dim">{e.review_status}</Badge>
                </div>
                {e.visible_summary && <p className="line-clamp-3 text-fg/80">{e.visible_summary}</p>}
              </div>
            </div>
            <div className="border-t border-line px-3 py-2 font-mono text-[10px] text-dim">
              <p className="truncate">sha256 {e.sha256}</p>
              <p>dHash {e.phash ?? "—"} · EXIF {e.metadata?.camera_make ? `${e.metadata.camera_make} ${e.metadata.camera_model ?? ""}` : "none"}{e.metadata?.has_gps ? " · GPS present (restricted)" : ""}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function EvidencePage() {
  return (
    <div>
      <PageHeader title="Evidence Center" description="Integrity hashes, perceptual duplicate detection, metadata signals and AI visual analysis for every submitted file. Metadata is never proof of authenticity; files are visible to authorised reviewers only." />
      <RequireStaff what="The Evidence Center"><EvidenceInner /></RequireStaff>
    </div>
  );
}
