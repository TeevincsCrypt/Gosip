# Requirements — GOS-IP Platform

Format: user stories with EARS acceptance criteria (WHEN / IF / THE SYSTEM SHALL).

## R1 Community incident reporting
**User story:** As a member of the public, I want to report an emergency quickly, with or without an account, so that responders can learn about it.

1. THE SYSTEM SHALL accept a report with title, description, category (10 categories), location text, optional coordinates, incident date/time, up to 5 photos/videos, optional contact details and an anonymous option.
2. WHEN required fields are missing or coordinates are out of range, THE SYSTEM SHALL reject the submission with field-level messages and store nothing.
3. WHEN an uploaded file's magic bytes do not match an allowed image/video type, or it exceeds the size limit, THE SYSTEM SHALL reject the submission and store nothing.
4. WHEN a report is anonymous, THE SYSTEM SHALL store no account link and no contact details.
5. WHEN a report is accepted, THE SYSTEM SHALL return a unique reference ID (`GSP-YYMMDD-XXXXXX`) and show a confirmation screen.
6. THE SYSTEM SHALL let users pick a location on a map, use browser geolocation with permission, or type coordinates.

## R2 Multi-agent AI investigation
1. WHEN a report is submitted, THE SYSTEM SHALL start an investigation with six separated agents: Classification (A), Evidence (B), Geospatial (C), Corroboration (D), Threat (E), Lead Investigator (F).
2. THE SYSTEM SHALL validate every agent output against a schema, apply a per-attempt timeout and bounded retries.
3. IF an agent fails or times out, THE SYSTEM SHALL preserve all other findings and mark the investigation `partial` (or `failed` if nothing succeeded) — never `completed`.
4. IF no AI provider is configured, THE SYSTEM SHALL record the investigation as `not_configured`, produce no AI findings and request human review.
5. THE SYSTEM SHALL store severity and confidence as separate values.
6. THE Lead Investigator SHALL cite the sources of each key finding and label its basis (user claim / AI assessment / deterministic / corroborated).
7. THE SYSTEM SHALL request human review for HIGH/CRITICAL severity, sensitive categories, low confidence, incomplete investigations, duplicate evidence or evidence inconsistencies.
8. Staff SHALL be able to re-run an investigation; each run is a new, numbered attempt.

## R3 Evidence management
1. THE SYSTEM SHALL compute SHA-256 and a 64-bit perceptual hash for every image and flag exact and near-duplicates of previously submitted images.
2. THE SYSTEM SHALL extract EXIF metadata and flag missing metadata, capture-time conflicts, GPS conflicts and editing-software tags, stating that these are signals, not proof.
3. THE Evidence agent SHALL distinguish visual relevance from authenticity.
4. Evidence files SHALL be stored privately and served only to analysts/administrators through an authorised route.

## R4 Cross-report intelligence graph
1. THE SYSTEM SHALL score report pairs on geographic, temporal, category, semantic and evidence similarity with fixed weights.
2. THE SYSTEM SHALL only link reports within a configurable radius and time window and above a configurable threshold.
3. Every relationship SHALL carry a human-readable explanation of its score.
4. Same-source submissions, identical images and near-identical text SHALL be typed `possible_duplicate` and SHALL NOT count as independent corroboration.
5. THE SYSTEM SHALL group linked reports into clusters (connected components) with stable identities.
6. WHEN a cluster has ≥2 independent sources, THE SYSTEM SHALL mark its unverified reports `corroborated`, and revert them if that no longer holds.
7. Reviewer decisions on relationships SHALL never be overwritten by the engine.
8. Synthetic data SHALL never correlate with real data.

## R5 Interactive map
1. THE SYSTEM SHALL render incidents from stored coordinates on an interactive MapLibre map with zoom/pan, marker clustering, severity colours, verification rings, cluster footprints and hotspots.
2. Users SHALL filter by category, severity and status and open incident details and cluster timelines.
3. Sensitive reports SHALL be shown at approximate (~1 km) precision publicly.

## R6 Command centre & live activity
1. THE dashboard SHALL show live database counts: total, active, under investigation, corroborated, verified, disputed, high-priority, recently resolved, plus clusters, category and geographic distribution and recent activity.
2. Every activity feed entry SHALL correspond to a stored system event.
3. Views SHALL update via Supabase Realtime when configured and via polling otherwise.

## R7 Intelligence reports
1. THE SYSTEM SHALL export a PDF with the 17 required sections, GOS-IP identity, synthetic labelling and the AI/emergency disclaimers.

## R8 Administration & human review
1. Analysts/admins SHALL verify, reject, dispute, escalate, de-escalate, resolve, reopen, annotate, merge, separate, confirm/reject relationships and accept/reject evidence.
2. Each action SHALL record actor, action, timestamp, previous state, new state and explanation in an append-only audit log.
3. THE database SHALL refuse verify/resolve transitions not made in a reviewer context.

## R9 Security & privacy
1. Authorisation SHALL be enforced by the API and PostgreSQL RLS, never by the frontend alone.
2. Public projections SHALL not expose contact details, reporter ids, fingerprints, storage paths or EXIF GPS.
3. Secrets SHALL be server-only.
