# Design — GOS-IP Platform

## Architecture

```
Browser (Next.js client pages, TanStack Query, MapLibre, d3-force, Recharts)
   │  fetch /api/*            ▲ Supabase Realtime (incident_events INSERT) / 4s polling
   ▼                          │
Next.js route handlers (src/app/api) ── handler(): session → Actor, role checks, error mapping
   │
   ├── services/reports        createReport → withActor (RLS)  → events (system)
   ├── services/correlation    PostGIS prefilter → engine.correlate → relationships → clusters
   ├── services/investigation  orchestrator: A → (B|C|D) → E → F, runAgent() per agent
   ├── services/review         withActor(asReviewer) → human_reviews + audit_logs + events
   └── services/insights       dashboard / analytics / map / graph queries (RLS views)
   │
PostgreSQL + PostGIS (Supabase)          Supabase Storage (private bucket)     Groq API
```

## Data model (db/migrations/0001_core_schema.sql)
profiles, credentials, reports, evidence, investigations, agent_findings, incident_clusters, cluster_relationships, report_relationships, incident_events, human_reviews, audit_logs, notifications. Coordinates are `geography(Point,4326)` with GiST indexes.

## Security model (0002_security_policies.sql)
- Two restricted roles: `gosip_anon`, `gosip_user`. Each user request runs `SET LOCAL ROLE` + `app.user_id`; role is resolved from `profiles` by a security-definer function.
- Public data is read through redacting views (`reports_public`, `evidence_public`, `investigations_public`, `agent_findings_public`).
- Trigger `guard_human_only_transitions` rejects verify/resolve and changes to human decisions unless `app.actor_type = 'reviewer'`.
- `audit_logs` is append-only (trigger).

Trade-off: authentication is app-managed (bcrypt + signed HTTP-only JWT cookie) instead of Supabase Auth, so the full security model is testable on plain PostgreSQL in CI. Supabase still provides Postgres/PostGIS, Storage and Realtime.

## Correlation engine (src/lib/correlation/engine.ts)
score = weighted mean of geo (0.30), temporal (0.20), category (0.20), semantic TF-IDF cosine (0.20), evidence perceptual-hash similarity (0.10; weight redistributed when either report has no imagery). Hard gates: radius (default 8 km), window (48 h), category/semantic sanity. Threshold 0.55. Types: corroborating (same category, independent), related (related category), possible_duplicate (same submitter, identical image or near-identical text). Clusters = connected components over active + reviewer-confirmed edges; identities kept by maximum member overlap.

## Agent pipeline (src/lib/services/investigation.ts)
| Stage | Agent | Input | Output schema |
|---|---|---|---|
| 1 | A Classification | report | `classificationSchema` |
| 2 | B Evidence | report, A, images, metadata checks | `evidenceSchema` |
| 2 | C Geospatial | report, A, PostGIS nearby reports, EXIF GPS distances | `geospatialSchema` |
| 2 | D Corroboration | report, A, engine relationships + texts | `corroborationSchema` |
| 3 | E Threat | report + A–D | `threatSchema` |
| 4 | F Lead | report + A–E + failure list | `leadSchema` |

`runAgent()` enforces a per-attempt timeout (AbortController), schema validation, retries for invalid output/timeouts/429/5xx, no retries for refusals/config errors. Results are persisted per agent with attempts, duration, tokens, input refs and deterministic inputs.

## Error handling
- Route handler wrapper maps validation (400), upload errors (413/415/422/502), auth (401/403), DB not configured (503).
- Investigation crashes are caught by `queueAndRun()`, which marks the run failed and requests review.
- UI shows explicit loading, empty and error states, and an "incomplete investigation" notice.

## Testing strategy
- Unit: correlation scoring/gates/duplicates/clustering, agent runner (success, invalid output, retry, timeout, refusal, transient errors), submission validation, evidence hashing and metadata flags.
- Integration (PostGIS): anonymous submission, invalid upload rollback, duplicate evidence, RLS (no raw access, no contact leakage, no self-verification, no pre-verified inserts), DB guard against AI verification, reviewer verification + audit, append-only audit, sensitive-location coarsening, five-report clustering, far report exclusion, reviewer separation persistence, dashboard counts, full six-agent run with a mock provider, partial failure, failure + retry, sensitive findings withheld.
- Browser smoke/E2E (Playwright, manual script): all pages render without runtime errors; mobile submission with photo → confirmation → detail → PDF; anonymous evidence access returns 401.
