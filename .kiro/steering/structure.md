---
inclusion: always
---

# Repository structure

- `db/migrations/` — ordered SQL migrations (schema, RLS, views, guards). Never edit an applied migration; add a new one.
- `db/seed/` — clearly labelled synthetic demonstration scenario.
- `scripts/` — migrate, seed, create-user, postinstall helpers.
- `src/lib/domain/` — shared vocabulary, Zod schemas, types (client-safe).
- `src/lib/correlation/engine.ts` — pure, deterministic correlation & clustering (unit tested).
- `src/lib/agents/` — agent schemas, prompts, runner (timeouts/retries/validation).
- `src/lib/ai/` — provider abstraction + Anthropic implementation.
- `src/lib/services/` — DB-backed services: reports, correlation, investigation orchestrator, review, insights, events.
- `src/lib/http/api.ts` — route handler wrapper (actor resolution, role checks, error mapping).
- `src/app/api/**` — route handlers. `src/app/(console)/**` — application pages. `src/app/(auth)/**` — login/register.
- `tests/unit`, `tests/integration`, `tests/support`.
