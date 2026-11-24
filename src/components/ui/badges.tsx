import * as React from "react";
import { FlaskConical } from "lucide-react";
import { categoryLabel, PROVENANCE, type Provenance } from "@/lib/domain/constants";
import { cn, humanize, pct } from "@/lib/client/utils";

export function Badge({ className, children, title }: { className?: string; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 text-[10.5px] font-medium uppercase tracking-wide",
        className,
      )}
    >
      {children}
    </span>
  );
}

const SEVERITY_STYLE: Record<string, string> = {
  CRITICAL: "border-critical/50 bg-critical/15 text-critical",
  HIGH: "border-danger/40 bg-danger/10 text-danger",
  MODERATE: "border-warn/40 bg-warn/10 text-warn",
  LOW: "border-low/40 bg-low/10 text-low",
};

export function SeverityBadge({ severity }: { severity: string | null | undefined }) {
  if (!severity) return <Badge className="border-line text-dim" title="Severity not assessed">Sev —</Badge>;
  return (
    <Badge className={SEVERITY_STYLE[severity]} title="Potential severity if the report is accurate (AI assessment)">
      {severity}
    </Badge>
  );
}

export const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: "#ff5a4e",
  HIGH: "#e06b5f",
  MODERATE: "#d9a441",
  LOW: "#7fa38f",
  NONE: "#84918a",
};

export function ConfidenceMeter({ value, className }: { value: number | null | undefined; className?: string }) {
  const v = value === null || value === undefined ? null : Number(value);
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} title="Confidence that the report is accurate (separate from severity)">
      <span className="relative h-1.5 w-14 overflow-hidden rounded-full bg-line">
        {v !== null && <span className="absolute inset-y-0 left-0 rounded-full bg-info" style={{ width: `${Math.round(v * 100)}%` }} />}
      </span>
      <span className="font-mono text-[11px] text-muted">{pct(v)}</span>
    </span>
  );
}

const VERIFICATION_STYLE: Record<string, string> = {
  unverified: "border-line-2 text-muted",
  corroborated: "border-info/40 bg-info/10 text-info",
  verified: "border-accent/50 bg-accent/15 text-accent",
  disputed: "border-warn/40 bg-warn/10 text-warn",
  rejected: "border-danger/40 bg-danger/10 text-danger",
};

const VERIFICATION_HELP: Record<string, string> = {
  unverified: "User-submitted claim. Not independently corroborated or reviewed.",
  corroborated: "Supported by at least two independent reports (automatic, not a confirmation).",
  verified: "Verified by an authorised human reviewer.",
  disputed: "A human reviewer has marked this report as disputed.",
  rejected: "Rejected by a human reviewer.",
};

export function VerificationBadge({ status }: { status: string }) {
  return (
    <Badge className={VERIFICATION_STYLE[status] ?? "border-line text-muted"} title={VERIFICATION_HELP[status]}>
      {humanize(status)}
    </Badge>
  );
}

const INVESTIGATION_STYLE: Record<string, string> = {
  pending: "border-line-2 text-muted",
  queued: "border-line-2 text-muted",
  running: "border-accent/40 text-accent",
  completed: "border-accent/30 text-accent/90",
  partial: "border-warn/40 text-warn",
  failed: "border-danger/40 text-danger",
  not_configured: "border-line-2 text-dim",
};

export function InvestigationBadge({ status }: { status: string }) {
  const label = status === "not_configured" ? "AI not configured" : status === "partial" ? "Incomplete" : humanize(status);
  return (
    <Badge className={INVESTIGATION_STYLE[status] ?? "border-line text-muted"} title="AI investigation status">
      {status === "running" && <span className="size-1.5 animate-pulse rounded-full bg-accent" />}
      {label}
    </Badge>
  );
}

export function ProvenanceTag({ kind, className }: { kind: Provenance; className?: string }) {
  const p = PROVENANCE[kind];
  const tone =
    p.tone === "accent"
      ? "border-accent/40 text-accent"
      : p.tone === "info"
        ? "border-info/40 text-info"
        : p.tone === "warn"
          ? "border-warn/40 text-warn"
          : "border-line-2 text-muted";
  return <Badge className={cn(tone, "normal-case tracking-normal", className)}>{p.label}</Badge>;
}

export function SyntheticTag({ className }: { className?: string }) {
  return (
    <Badge className={cn("border-warn/40 bg-warn/10 text-warn", className)} title="Clearly labelled synthetic demonstration data. This incident did not happen.">
      <FlaskConical className="size-3" />
      Synthetic
    </Badge>
  );
}

export function CategoryTag({ category }: { category: string }) {
  return <Badge className="border-line-2 normal-case tracking-normal text-fg/80">{categoryLabel(category)}</Badge>;
}
