---
inclusion: fileMatch
fileMatchPattern: "src/lib/{agents,services,ai}/**/*.ts"
---

# Trust & safety rules for AI and data code

- Agents receive no contact details or reporter identity.
- Every agent output is schema-validated; invalid output is retried, then recorded as a failure — never patched with made-up values.
- An agent failure marks the investigation `partial` (or `failed`). Never `completed`.
- The Lead Investigator must cite sources (`refs`) for every key finding.
- AI may recommend escalation or human review; it may not set `verified`, `rejected`, `disputed`, `resolved` or `priority_escalated`.
- Public projections (`reports_public`, `evidence_public`, `investigations_public`, `agent_findings_public`) must never expose contact details, reporter ids, fingerprints, storage paths or EXIF GPS; findings of sensitive reports are withheld.
- Relationships must be explainable from measured components; do not add AI-only links.
