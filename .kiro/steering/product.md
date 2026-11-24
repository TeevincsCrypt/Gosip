---
inclusion: always
---

# GOS-IP — Product steering

**GOS-IP (Global Open-Source Situational Intelligence Platform)** turns fragmented community emergency reports into structured, evidence-backed situational intelligence.

Pipeline: individual reports → AI investigation → evidence correlation → incident intelligence → human decision.

## The five core capabilities (protect these above everything else)
1. Community reporting (anonymous allowed, photos/video, map/GPS/manual location).
2. Multi-agent AI investigation (six specialised agents A–F, structured outputs).
3. Evidence analysis (SHA-256, perceptual hash duplicates, metadata signals, multimodal AI relevance).
4. Cross-report intelligence clustering (explainable, threshold-based, graph view).
5. Interactive intelligence map (MapLibre, clustering, filters).

## Signature moment for the demo
Five people independently report a flood in Ibadan. GOS-IP links them through explainable relationships, analyses evidence, maps the developing situation and produces one intelligence assessment that a human reviewer can verify.

## Non-negotiables
- Never present unverified claims as fact. Label provenance: user claim / AI assessment / deterministic / corroborated / human-reviewed / official.
- Never fabricate AI output, corroboration, external sources or statistics. If the AI provider is not configured, say so.
- Severity and confidence are separate measurements.
- Only humans verify, reject, dispute, escalate or resolve. The database enforces this.
- Synthetic demo data is always labelled and never correlates with real data.
- Protect anonymous reporters; coarsen locations of sensitive (violence/security) reports.
