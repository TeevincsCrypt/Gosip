---
inclusion: always
---

# Technology steering

- **Next.js 16 (App Router) + TypeScript**, Tailwind CSS v4, hand-written shadcn-style primitives in `src/components/ui`, Lucide icons, TanStack Query.
  - Next 16 has breaking changes: `middleware` is now `proxy`, route `params` are Promises. Read `node_modules/next/dist/docs/` before using unfamiliar APIs.
- **PostgreSQL + PostGIS** (Supabase-hosted in production). Access via the `postgres` driver with `prepare: false` (pooler compatible).
  - User-initiated queries MUST use `withActor()` (switches to `gosip_anon` / `gosip_user`, RLS enforced).
  - Only trusted system code (pipeline, correlation, seed) may use `withSystem()`.
- **Supabase Storage** (private bucket) for evidence; local filesystem only for development. **Supabase Realtime** optional; polling fallback always on.
- **AI**: Groq via `groq-sdk` (`src/lib/ai/groq.ts`). Structured outputs with a strict JSON schema generated from the agent's Zod schema, falling back to JSON mode if a model rejects `json_schema`; always re-validated with Zod. Text agents use `AI_MODEL`, the evidence agent uses `AI_VISION_MODEL`. Keys are server-only (`import "server-only"`).
- **Maps**: MapLibre GL JS v6; worker served from `/vendor/maplibre-gl-worker.mjs` (copied on postinstall).
- **Tests**: Vitest. Integration tests need PostGIS (`TEST_DATABASE_URL`). Never call a real AI provider in tests — use `tests/support/mock-provider.ts`.
- Commands: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run db:migrate`, `npm run db:seed`.
