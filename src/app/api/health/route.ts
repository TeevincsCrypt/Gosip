import { json } from "@/lib/http/api";
import { config, isAiConfigured } from "@/lib/config";
import { getSql } from "@/lib/db/client";

/** Integration status shown in the UI so nothing pretends to be connected when it is not. */
export async function GET() {
  let database: "connected" | "not_configured" | "error" = "not_configured";
  if (config.databaseUrl) {
    try {
      await getSql()`select 1`;
      database = "connected";
    } catch {
      database = "error";
    }
  }
  return json({
    database,
    ai: isAiConfigured() ? { status: "configured", provider: config.ai.provider, model: config.ai.model } : { status: "not_configured" },
    storage: config.storage.supabaseUrl && config.storage.serviceRoleKey ? "supabase" : process.env.VERCEL ? "not_configured" : "local",
    realtime: process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "supabase" : "polling",
    correlation: config.correlation,
    demoMode: config.demoMode,
  });
}
