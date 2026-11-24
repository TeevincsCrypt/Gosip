# Kiro usage & development provenance

The hackathon rules require Kiro to be used in a meaningful, demonstrable way and forbid misrepresenting other tools as Kiro. This file is the single place where we record **who or what produced each artifact**. Keep it truthful; judges may compare it against the commit history.

## Provenance log

| Date (UTC) | Tool | What was produced | Notes |
|---|---|---|---|
| 2026-11-24 | **Claude Code** (Anthropic), cloud session | Initial application code, migrations, tests, README, CI workflow, **and the first drafts of** `.kiro/specs/gos-ip-platform/{requirements,design,tasks}.md`, `.kiro/steering/*.md`, `.kiro/hooks/*.kiro.hook`, `.kiro/agents/gosip-dev.json` | These `.kiro` files were **written by Claude Code, not generated or executed by Kiro**. The hooks and agent config have **not been run** yet. The Kiro CLI agent JSON schema was written from memory and must be validated with Kiro before use. |
| _next_ | **Kiro** | _record real Kiro sessions here_ | e.g. "Opened spec in Kiro, refined R4 acceptance criteria, Kiro generated tasks 7.4–7.6" |

## How to use Kiro from here (and what to record)

1. **Steering**: open the repository in Kiro IDE or start `kiro-cli` in the repo root. Confirm the steering files in `.kiro/steering/` load, and edit them through Kiro as the project evolves.
2. **Specs**: open `.kiro/specs/gos-ip-platform/` in Kiro's spec view. Use Kiro to refine requirements and design, and to execute the open tasks (2.7, 3.7, 6.4, 7.3–7.5). Commit Kiro's changes separately, with messages that say so.
3. **Hooks**: enable the three hooks in Kiro's hook panel, then edit a matching file to trigger each one at least once. Record the outcome below.
4. **Kiro CLI agent**: validate `.kiro/agents/gosip-dev.json` with the CLI (`/agent` commands). Fix the schema if Kiro rejects it, and record what changed.
5. Take screenshots of Kiro running specs and hooks for the Devpost write-up.

## Hook execution record

| Hook | Triggered on | Result | Date |
|---|---|---|---|
| test-on-engine-change | — | not yet run | — |
| migration-safety-review | — | not yet run | — |
| server-only-secrets | — | not yet run | — |
