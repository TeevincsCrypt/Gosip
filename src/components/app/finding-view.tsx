"use client";

import * as React from "react";
import { humanize } from "@/lib/client/utils";
import { categoryLabel } from "@/lib/domain/constants";

/**
 * Generic, readable rendering of an agent's structured JSON output. Keys are
 * humanised; arrays of objects become compact cards; nothing is invented.
 */
export function FindingView({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined || value === "") return <span className="text-dim">—</span>;
  if (typeof value === "boolean") return <span className={value ? "text-warn" : "text-muted"}>{value ? "Yes" : "No"}</span>;
  if (typeof value === "number") return <span className="font-mono">{Number.isInteger(value) ? value : value.toFixed(2)}</span>;
  if (typeof value === "string") {
    return <span className="whitespace-pre-wrap">{/^[a-z_]+$/.test(value) && value.length < 40 ? humanize(categoryLabel(value)) : value}</span>;
  }
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-dim">None</span>;
    if (value.every((v) => typeof v !== "object" || v === null)) {
      return (
        <ul className="list-disc space-y-0.5 pl-4">
          {value.map((v, i) => (
            <li key={i}>
              <FindingView value={v} depth={depth + 1} />
            </li>
          ))}
        </ul>
      );
    }
    return (
      <div className="space-y-2">
        {value.map((v, i) => (
          <div key={i} className="rounded-md border border-line bg-bg-2 p-2.5">
            <FindingView value={v} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  return (
    <dl className={depth === 0 ? "space-y-3" : "space-y-1.5"}>
      {entries.map(([k, v]) => (
        <div key={k} className={depth === 0 ? "" : "grid gap-x-3 sm:grid-cols-[140px_1fr]"}>
          <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-dim">{humanize(k)}</dt>
          <dd className="mt-0.5 text-[13px] leading-relaxed text-fg/90">
            <FindingView value={v} depth={depth + 1} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
