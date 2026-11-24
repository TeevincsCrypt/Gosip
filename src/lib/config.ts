import "server-only";

/**
 * Centralised, server-only configuration. Nothing in this module may be
 * imported by client components (enforced by the `server-only` import).
 */
function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

function numberOr(name: string, fallback: number): number {
  const raw = optional(name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  databaseUrl: optional("DATABASE_URL"),
  sessionSecret: optional("SESSION_SECRET"),
  fingerprintSecret: optional("FINGERPRINT_SECRET") ?? optional("SESSION_SECRET"),
  appUrl: optional("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000",
  /** Allows submissions explicitly marked as synthetic demo data (judging/demo deployments). */
  demoMode: optional("DEMO_MODE") === "true",

  ai: {
    provider: (optional("AI_PROVIDER") ?? "anthropic") as "anthropic",
    apiKey: optional("ANTHROPIC_API_KEY"),
    model: optional("AI_MODEL") ?? "claude-opus-5-5",
    agentTimeoutMs: numberOr("AI_AGENT_TIMEOUT_MS", 90_000),
    maxAttempts: numberOr("AI_AGENT_MAX_ATTEMPTS", 2),
    enableFallbacks: (optional("AI_ENABLE_FALLBACKS") ?? "true") === "true",
  },

  storage: {
    supabaseUrl: optional("NEXT_PUBLIC_SUPABASE_URL"),
    serviceRoleKey: optional("SUPABASE_SERVICE_ROLE_KEY"),
    bucket: optional("SUPABASE_EVIDENCE_BUCKET") ?? "evidence",
    localDir: optional("LOCAL_UPLOAD_DIR") ?? ".data/uploads",
    maxFileBytes: numberOr("MAX_UPLOAD_BYTES", 8 * 1024 * 1024),
    maxFiles: numberOr("MAX_UPLOAD_FILES", 5),
  },

  correlation: {
    radiusKm: numberOr("CLUSTER_RADIUS_KM", 8),
    windowHours: numberOr("CLUSTER_WINDOW_HOURS", 48),
    threshold: numberOr("CLUSTER_THRESHOLD", 0.55),
  },
} as const;

export function isAiConfigured(): boolean {
  return Boolean(config.ai.apiKey);
}

export function requireDatabaseUrl(): string {
  if (!config.databaseUrl) {
    throw new Error(
      "DATABASE_URL is not configured. See .env.example and README (Database setup).",
    );
  }
  return config.databaseUrl;
}
