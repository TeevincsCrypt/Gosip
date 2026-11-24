"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  BarChart3,
  Bell,
  FileText,
  FolderSearch,
  LayoutDashboard,
  LogIn,
  LogOut,
  Map as MapIcon,
  Menu,
  Network,
  Plus,
  Radar,
  ShieldCheck,
  X,
} from "lucide-react";
import { api, cn, timeAgo } from "@/lib/client/utils";
import { EMERGENCY_DISCLAIMER } from "@/lib/domain/constants";
import { useHealth, useSession } from "./providers";
import { Wordmark } from "./brand";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/map", label: "Live Intelligence Map", icon: MapIcon },
  { href: "/reports", label: "Incident Reports", icon: FileText },
  { href: "/investigations", label: "Investigations", icon: Radar },
  { href: "/intelligence-graph", label: "Intelligence Graph", icon: Network },
  { href: "/evidence", label: "Evidence Center", icon: FolderSearch },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/admin", label: "Administration", icon: ShieldCheck },
];

function IntegrationStatus() {
  const { data } = useHealth();
  if (!data) return null;
  const items = [
    { label: "Database", ok: data.database === "connected", value: data.database === "connected" ? "Connected" : data.database === "error" ? "Error" : "Not configured" },
    { label: "AI agents", ok: data.ai.status === "configured", value: data.ai.status === "configured" ? data.ai.model ?? "Configured" : "Not configured" },
    { label: "Evidence storage", ok: data.storage !== "not_configured", value: data.storage === "supabase" ? "Supabase" : data.storage === "local" ? "Local (dev)" : "Not configured" },
    { label: "Live updates", ok: true, value: data.realtime === "supabase" ? "Realtime + polling" : "Polling (4s)" },
  ];
  return (
    <div className="space-y-1.5 rounded-md border border-line bg-bg-2 p-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-dim">System status</p>
      {items.map((i) => (
        <div key={i.label} className="flex items-center justify-between gap-2 text-[11px]">
          <span className="flex items-center gap-1.5 text-muted">
            <span className={cn("size-1.5 rounded-full", i.ok ? "bg-accent" : "bg-warn")} />
            {i.label}
          </span>
          <span className={cn("truncate font-mono", i.ok ? "text-fg/80" : "text-warn")}>{i.value}</span>
        </div>
      ))}
    </div>
  );
}

function Notifications() {
  const { user } = useSession();
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<{ items: { id: string; title: string; body: string; report_id: string | null; read_at: string | null; created_at: string; kind: string }[] }>("/api/notifications"),
    enabled: Boolean(user),
  });
  if (!user) return null;
  const unread = data?.items.filter((n) => !n.read_at) ?? [];
  return (
    <div className="relative">
      <button
        aria-label="Notifications"
        onClick={async () => {
          setOpen((o) => !o);
          if (!open && unread.length) {
            await api("/api/notifications", { method: "POST", body: JSON.stringify({ ids: unread.map((n) => n.id) }) });
            qc.invalidateQueries({ queryKey: ["notifications"] });
          }
        }}
        className="relative grid size-8 place-items-center rounded-md text-muted hover:bg-panel-2 hover:text-fg"
      >
        <Bell className="size-4" />
        {unread.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[9px] font-semibold text-white">{unread.length}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-lg border border-line bg-panel shadow-2xl">
          <p className="border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Notifications</p>
          <div className="max-h-96 overflow-y-auto">
            {!data?.items.length && <p className="px-3 py-6 text-center text-xs text-muted">No notifications.</p>}
            {data?.items.map((n) => (
              <Link
                key={n.id}
                href={n.report_id ? `/reports/${n.report_id}` : "/admin"}
                onClick={() => setOpen(false)}
                className="block border-b border-line/60 px-3 py-2.5 hover:bg-panel-2"
              >
                <p className={cn("text-xs", n.kind.startsWith("escalation") ? "text-danger" : "text-fg")}>{n.title}</p>
                {n.body && <p className="mt-0.5 line-clamp-2 text-[11px] text-muted">{n.body}</p>}
                <p className="mt-1 text-[10px] text-dim">{timeAgo(n.created_at)}</p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user } = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  if (!user) {
    return (
      <Link href="/login" className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-line px-2.5 text-xs text-fg hover:bg-panel-2">
        <LogIn className="size-3.5" /> Sign in
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <div className="hidden text-right sm:block">
        <p className="text-xs text-fg">{user.displayName}</p>
        <p className="text-[10px] uppercase tracking-wider text-dim">{user.role}</p>
      </div>
      <button
        aria-label="Sign out"
        title="Sign out"
        onClick={async () => {
          await api("/api/auth/logout", { method: "POST" });
          await qc.invalidateQueries();
          router.refresh();
        }}
        className="grid size-8 place-items-center rounded-md text-muted hover:bg-panel-2 hover:text-fg"
      >
        <LogOut className="size-4" />
      </button>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const nav = (
    <nav className="space-y-0.5" aria-label="Primary">
      {NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            onClick={() => setMobileOpen(false)}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors",
              active ? "bg-panel-2 text-fg shadow-[inset_2px_0_0_var(--color-accent)]" : "text-muted hover:bg-panel hover:text-fg",
            )}
          >
            <Icon className={cn("size-4", active ? "text-accent" : "text-dim")} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-bg-2 lg:flex">
        <Link href="/" className="flex h-14 items-center border-b border-line px-4">
          <Wordmark />
        </Link>
        <div className="flex-1 overflow-y-auto p-3">
          <Link
            href="/report"
            className="mb-4 flex h-9 items-center justify-center gap-1.5 rounded-md bg-accent text-sm font-medium text-accent-ink hover:bg-accent-strong"
          >
            <Plus className="size-4" /> Report an incident
          </Link>
          {nav}
        </div>
        <div className="space-y-3 border-t border-line p-3">
          <IntegrationStatus />
          <p className="text-[10px] leading-relaxed text-dim">{EMERGENCY_DISCLAIMER}</p>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col border-r border-line bg-bg-2">
            <div className="flex h-14 items-center justify-between border-b border-line px-4">
              <Wordmark />
              <button aria-label="Close menu" onClick={() => setMobileOpen(false)} className="text-muted">
                <X className="size-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">{nav}</div>
            <div className="border-t border-line p-3">
              <IntegrationStatus />
            </div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-3 border-b border-line bg-bg/90 px-4 backdrop-blur lg:px-6">
          <div className="flex items-center gap-3">
            <button aria-label="Open menu" className="text-muted lg:hidden" onClick={() => setMobileOpen(true)}>
              <Menu className="size-5" />
            </button>
            <Link href="/" className="lg:hidden">
              <Wordmark />
            </Link>
            <span className="hidden items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-dim lg:flex">
              <Activity className="size-3.5 text-accent" /> Global Open-Source Situational Intelligence Platform
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/report" className="inline-flex h-8 items-center gap-1 rounded-md bg-accent px-2.5 text-xs font-medium text-accent-ink lg:hidden">
              <Plus className="size-3.5" /> Report
            </Link>
            <Notifications />
            <UserMenu />
          </div>
        </header>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-line px-4 py-5 sm:flex-row sm:items-end sm:justify-between lg:px-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
