"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/utils";
import type { SessionUser } from "@/lib/domain/types";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: true, retry: 1 } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <LiveSync />
      {children}
    </QueryClientProvider>
  );
}

export function useSession() {
  const q = useQuery({
    queryKey: ["session"],
    queryFn: () => api<{ user: SessionUser | null }>("/api/auth/me"),
    staleTime: 60_000,
  });
  const user = q.data?.user ?? null;
  return {
    user,
    loading: q.isLoading,
    isStaff: user?.role === "analyst" || user?.role === "admin",
    isAdmin: user?.role === "admin",
  };
}

export interface Health {
  database: "connected" | "not_configured" | "error";
  ai: { status: "configured" | "not_configured"; provider?: string; model?: string };
  storage: "supabase" | "local" | "not_configured";
  realtime: "supabase" | "polling";
  correlation: { radiusKm: number; windowHours: number; threshold: number };
  demoMode: boolean;
}

export function useHealth() {
  return useQuery({ queryKey: ["health"], queryFn: () => api<Health>("/api/health"), staleTime: 60_000 });
}

/** Query keys refreshed whenever a new system event is observed. */
const LIVE_KEYS = ["stats", "events", "reports", "report", "map", "investigations", "investigation", "graph", "clusters", "queue", "evidence", "analytics", "notifications", "audit"];

/**
 * Keeps every view live. Subscribes to Supabase Realtime inserts on
 * incident_events when configured; always polls the event stream as a
 * reliable fallback. Either signal invalidates the cached queries.
 */
function LiveSync() {
  const qc = useQueryClient();
  const lastSeen = React.useRef<number | null>(null);

  const refresh = React.useCallback(() => {
    for (const key of LIVE_KEYS) qc.invalidateQueries({ queryKey: [key] });
  }, [qc]);

  useQuery({
    queryKey: ["live-head"],
    queryFn: async () => {
      const { items } = await api<{ items: { id: number }[] }>("/api/events?limit=1");
      const head = items[0]?.id ?? 0;
      if (lastSeen.current !== null && head !== lastSeen.current) refresh();
      lastSeen.current = head;
      return head;
    },
    refetchInterval: 4_000,
    refetchIntervalInBackground: false,
  });

  React.useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return;
    let cleanup: (() => void) | undefined;
    import("@supabase/supabase-js")
      .then(({ createClient }) => {
        const client = createClient(url, key, { auth: { persistSession: false } });
        const channel = client
          .channel("gosip-events")
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "incident_events" }, () => refresh())
          .subscribe();
        cleanup = () => {
          client.removeChannel(channel);
        };
      })
      .catch(() => {
        /* polling fallback remains active */
      });
    return () => cleanup?.();
  }, [refresh]);

  return null;
}
