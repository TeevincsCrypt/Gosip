# GOS-IP — Global Open-Source Situational Intelligence Platform

> **Every report matters. Every incident deserves investigation.**

GOS-IP turns fragmented community emergency reports into structured, evidence-backed situational intelligence. Specialised AI agents investigate each report, an explainable correlation engine discovers which reports describe the same developing event, and accountable human reviewers make the final call.

```
INDIVIDUAL REPORTS → AI INVESTIGATION → EVIDENCE CORRELATION → INCIDENT INTELLIGENCE → HUMAN DECISION
```

Built for **Kiroween 2026 — Frankenstein category**: crowdsourced reporting, multimodal AI agents, geospatial intelligence, perceptual-hash evidence forensics and graph-based correlation stitched into one emergency investigation system.

> GOS-IP is an information and situational awareness platform. It does not replace emergency services, official authorities or professional emergency response.

---

## What it does

| Capability | Implementation |
|---|---|
| **Community reporting** | Anonymous or signed-in submissions, 10 categories, photos/videos, map pick / GPS / manual coordinates, reference IDs (`GSP-YYMMDD-XXXXXX`). |
| **Multi-agent investigation** | Six separated agents with validated JSON outputs: **A** Classification · **B** Evidence (multimodal) · **C** Geospatial · **D** Corroboration · **E** Threat · **F** Lead Investigator. Timeouts, retries, partial-failure handling, per-agent logs. |
| **Evidence analysis** | SHA-256 integrity hashes, 64-bit perceptual hashes (exact/near-duplicate detection across all submissions), EXIF signals (missing metadata, time/GPS conflicts, editing software), magic-byte file validation, AI visual relevance — explicitly *not* a claim of authenticity. |
| **Cross-report intelligence graph** | Pairwise scoring on geography (30%), time (20%), category (20%), text TF-IDF (20%) and imagery (10%), gated by radius/window and a configurable threshold. Every link carries a written explanation. Same-source and duplicate-image reports never count as independent corroboration. |
| **Interactive map** | MapLibre GL with marker clustering, severity colours, verification rings, cluster footprints, hotspots, filters and cluster timelines. Sensitive reports shown at ~1 km precision. |
| **Command centre** | Live database counts, activity chart, category & geographic distribution, active clusters, high-priority incidents and a live event feed (Supabase Realtime + polling fallback). |
| **Intelligence reports** | 17-section PDF export with provenance labels, synthetic-data labelling and disclaimers. |
| **Human review** | Verify / reject / dispute / escalate / resolve / note / merge / separate / confirm or reject links / accept or reject evidence — each recorded in an append-only audit log. |

### Responsible by construction
- **Provenance everywhere**: user claim · AI assessment · deterministic computation · independently corroborated · human-reviewed · official.
- **Severity ≠ confidence**: stored and displayed separately.
- **AI cannot verify**: a database trigger rejects `verified`/`resolved` transitions unless the transaction is a human reviewer action.
- **Database-enforced access**: every user request runs under a restricted PostgreSQL role with row-level security; public data comes from redacting views that never expose contact details, reporter identity, fingerprints, storage paths or EXIF GPS.
- **No fabrication**: without an AI key, investigations are recorded as *AI not configured* and routed to human review. No external sources are integrated, and agents are instructed never to cite any.
- **Synthetic data is labelled** in UI, API and PDFs, and never correlates with real reports.

---

## Architecture

- **Frontend**: Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · shadcn-style primitives (`src/components/ui`) · Lucide · TanStack Query · MapLibre GL v6 · d3-force · Recharts
- **Backend**: Next.js route handlers · PostgreSQL + PostGIS (Supabase) · Supabase Storage (private bucket) · Supabase Realtime (optional)
- **AI**: Claude via the official Anthropic SDK with structured outputs (`client.beta.messages.parse` + Zod schemas). Model configurable with `AI_MODEL` (default `claude-opus-5-5`). Keys never reach the browser.
- **Evidence**: `sharp` (dHash), `exifr`, Node `crypto`
- **PDF**: `pdf-lib`

Design trade-off: authentication is app-managed (bcrypt + signed HTTP-only cookie) rather than Supabase Auth, so the entire security model, including RLS, is exercised by the integration tests on plain PostGIS in CI. See [`.kiro/specs/gos-ip-platform/design.md`](.kiro/specs/gos-ip-platform/design.md).

```
db/migrations/        SQL schema, RLS, views, guards
db/seed/              synthetic demonstration scenario
scripts/              migrate · seed · create-user
src/lib/correlation/  deterministic correlation & clustering engine
src/lib/agents/       agent schemas, prompts, runner
src/lib/services/     reports · correlation · investigation · review · insights
src/app/api/          route handlers
src/app/(console)/    application pages
tests/                unit + PostGIS integration tests
.kiro/                specs, steering, hooks, agent config
```

### Routes
`/` landing · `/dashboard` command centre · `/map` · `/report` · `/reports` · `/reports/[id]` · `/investigations` · `/investigations/[id]` · `/intelligence-graph` · `/evidence` (staff) · `/analytics` · `/admin` (staff) · `/admin/review` (staff) · `/login` · `/register`

---

## Local development

Requirements: Node 22+, PostgreSQL 15+ with PostGIS.

```bash
npm install                       # also copies the MapLibre worker into public/vendor
cp .env.example .env.local        # set DATABASE_URL and SESSION_SECRET (and ANTHROPIC_API_KEY for AI)
npm run db:migrate
npm run db:seed                   # synthetic demo scenario (add -- --investigate to run real AI agents)
GOSIP_USER_PASSWORD='choose-a-strong-one' npm run db:create-user -- --email you@example.org --name "You" --role admin
npm run dev
```

Quick PostGIS via Docker: `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgis/postgis:16-3.4`

### Tests
```bash
npm run typecheck && npm run lint
npm test                          # unit + integration (integration needs TEST_DATABASE_URL, default postgres://postgres:postgres@localhost:5432/gosip_test)
```
The integration suite recreates the test database schema from the migrations. Tests never call a real AI provider; orchestration is tested with a mock provider.

---

## Deployment (Vercel + Supabase)

1. **Supabase**: create a project. PostGIS is enabled by the first migration (`create extension if not exists postgis`).
2. Run migrations against the **direct** connection string: `DATABASE_URL=... npm run db:migrate`.
3. **Storage**: create a **private** bucket named `evidence` (or set `SUPABASE_EVIDENCE_BUCKET`).
4. **Realtime** (optional): migration `0002` adds `incident_events` to the `supabase_realtime` publication and lets the `anon` role see only the id/type of public events, so clients know when to refresh. All data still flows through the authorised API.
5. **Vercel**: import the repository and set the variables from `.env.example`. Use the Supabase **transaction pooler** URI for `DATABASE_URL`. Set `SESSION_SECRET`, `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Set `DEMO_MODE=true` on a judging deployment.
6. Seed and create reviewer accounts from your machine with the production `DATABASE_URL`.

Investigations run after the response using Next.js `after()`; the report route sets `maxDuration = 300`.

---

## Demo scenario (synthetic)

`npm run db:seed` creates 13 **clearly labelled synthetic** reports, including the core scenario: five independent reports of a developing flood across Bodija, Agbowo, the UI road, Sango and Mokola in Ibadan. It also includes a same-source update (flagged as a possible duplicate), a far-away flood in Abeokuta (not linked), a two-report fire cluster in Lagos, and single incidents elsewhere, among them a sensitive report shown at approximate precision.

Suggested walkthrough: dashboard → submit a report with a photo near Bodija (demo mode marks it synthetic) → watch agents A–F run → evidence findings and uncertainty → related reports and explanations → intelligence graph → map → PDF → reviewer verifies in `/admin/review` and the audit trail records it.

---

## Status

See [`.kiro/specs/gos-ip-platform/tasks.md`](.kiro/specs/gos-ip-platform/tasks.md) for the task checklist. Known gaps: video frames are stored and hashed but not AI-analysed; roles are granted through a script, not yet through the UI; there is no deployed URL yet.

## How Kiro was used

See [`docs/KIRO_USAGE.md`](docs/KIRO_USAGE.md). That file separates artifacts drafted with Claude Code from work done with Kiro, and is where the team records real Kiro sessions.

## License

[MIT](LICENSE)
