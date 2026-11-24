# Implementation tasks — GOS-IP Platform

Status reflects the repository as of the last commit. `[x]` = implemented and verified by tests or a browser run; `[ ]` = open.

## 1. Foundation
- [x] 1.1 Next.js 16 + TypeScript + Tailwind v4 project, design tokens, UI primitives _(R6)_
- [x] 1.2 PostGIS schema with 13 tables, indexes and constraints _(R1–R9)_
- [x] 1.3 RLS roles, redacting views, human-only transition guard, append-only audit _(R8, R9)_
- [x] 1.4 Migration runner, seed script (synthetic scenario), create-user script
- [x] 1.5 App-managed auth (bcrypt, signed cookie), role resolved from DB _(R9)_

## 2. Reporting & evidence
- [x] 2.1 Submission API with Zod validation, magic-byte sniffing, size limits _(R1.1–R1.3)_
- [x] 2.2 Anonymous reporting without contact storage _(R1.4)_
- [x] 2.3 Reference IDs + confirmation screen _(R1.5)_
- [x] 2.4 Map picker, geolocation, manual coordinates _(R1.6)_
- [x] 2.5 SHA-256 + dHash + EXIF flags + duplicate detection _(R3.1, R3.2)_
- [x] 2.6 Private storage (Supabase / local dev) + authorised file route _(R3.4)_
- [ ] 2.7 Video frame extraction for AI analysis (videos are stored and hashed only)

## 3. AI investigation
- [x] 3.1 Provider abstraction + Claude implementation (structured outputs, refusal fallback) _(R2.2)_
- [x] 3.2 Agent schemas and prompts A–F _(R2.1, R2.6)_
- [x] 3.3 Runner: timeout, retries, validation _(R2.2)_
- [x] 3.4 Orchestrator with partial-failure semantics and not-configured state _(R2.3, R2.4)_
- [x] 3.5 Human-review policy and staff notifications _(R2.7)_
- [x] 3.6 Re-run / retry endpoint _(R2.8)_
- [ ] 3.7 Run the full pipeline against the live Claude API with a real key and record outputs for the demo

## 4. Correlation & graph
- [x] 4.1 Pure correlation engine with explanations _(R4.1–R4.4)_
- [x] 4.2 PostGIS candidate prefilter + relationship persistence _(R4.2)_
- [x] 4.3 Stable clustering + corroboration status _(R4.5, R4.6)_
- [x] 4.4 Reviewer overrides respected _(R4.7)_; synthetic/real separation _(R4.8)_
- [x] 4.5 Intelligence graph UI (reports, clusters, evidence, places, time, findings; edge inspector)

## 5. Map, dashboard, reports
- [x] 5.1 MapLibre map with clustering, filters, cluster footprints, hotspots, timelines _(R5)_
- [x] 5.2 Command centre with live counts and activity feed _(R6)_
- [x] 5.3 Realtime subscription + polling fallback _(R6.3)_
- [x] 5.4 PDF intelligence report _(R7)_
- [x] 5.5 Analytics page

## 6. Administration
- [x] 6.1 Review actions incl. merge/separate, relationship and evidence review _(R8.1)_
- [x] 6.2 Audit trail UI _(R8.2)_
- [x] 6.3 Review queue and notifications
- [ ] 6.4 Admin UI for granting roles (currently via `npm run db:create-user`)

## 7. Quality & submission
- [x] 7.1 Unit + integration tests (53) passing locally
- [x] 7.2 CI workflow with PostGIS service
- [ ] 7.3 Deploy to Vercel + Supabase and smoke-test the public URL
- [ ] 7.4 Automated Playwright E2E in CI
- [ ] 7.5 Screenshots, demo video (< 3 min), Devpost write-up, documented Kiro usage
