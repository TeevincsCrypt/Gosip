/** Shared vocabulary. Safe to import from client and server code. */

export const CATEGORIES = [
  { id: "flooding", label: "Flooding" },
  { id: "fire", label: "Fire outbreak" },
  { id: "road_accident", label: "Road accident" },
  { id: "infrastructure_failure", label: "Infrastructure failure" },
  { id: "violence_security", label: "Violence / security incident" },
  { id: "medical_emergency", label: "Medical emergency" },
  { id: "natural_disaster", label: "Natural disaster" },
  { id: "environmental", label: "Environmental incident" },
  { id: "public_safety", label: "Public safety threat" },
  { id: "other", label: "Other" },
] as const;

export type Category = (typeof CATEGORIES)[number]["id"];
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as [Category, ...Category[]];

export function categoryLabel(id: string): string {
  return CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

/** Categories whose reports are treated as sensitive (coarse public location, withheld findings). */
export const SENSITIVE_CATEGORIES: readonly Category[] = ["violence_security"];

/**
 * Categories that frequently co-occur in one developing event. Used by the
 * correlation engine to give partial category credit (e.g. flooding blocking a road).
 */
export const RELATED_CATEGORIES: Record<Category, readonly Category[]> = {
  flooding: ["natural_disaster", "infrastructure_failure", "road_accident", "public_safety", "environmental"],
  fire: ["public_safety", "infrastructure_failure", "environmental", "medical_emergency"],
  road_accident: ["medical_emergency", "public_safety", "infrastructure_failure", "flooding"],
  infrastructure_failure: ["flooding", "road_accident", "public_safety", "natural_disaster", "fire"],
  violence_security: ["public_safety", "medical_emergency"],
  medical_emergency: ["road_accident", "violence_security", "fire", "public_safety"],
  natural_disaster: ["flooding", "infrastructure_failure", "environmental", "public_safety"],
  environmental: ["flooding", "fire", "natural_disaster", "public_safety"],
  public_safety: ["violence_security", "fire", "flooding", "road_accident", "infrastructure_failure"],
  other: [],
};

export const SEVERITIES = ["LOW", "MODERATE", "HIGH", "CRITICAL"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const VERIFICATION_STATUSES = ["unverified", "corroborated", "verified", "disputed", "rejected"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const INVESTIGATION_STATUSES = [
  "pending", "queued", "running", "completed", "partial", "failed", "not_configured",
] as const;
export type InvestigationStatus = (typeof INVESTIGATION_STATUSES)[number];

export const LIFECYCLE_STATUSES = ["active", "resolved", "archived"] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

export const AGENTS = [
  { id: "classification", code: "A", name: "Intelligence Classification Agent" },
  { id: "evidence", code: "B", name: "Evidence Analysis Agent" },
  { id: "geospatial", code: "C", name: "Geospatial Intelligence Agent" },
  { id: "corroboration", code: "D", name: "Corroboration Agent" },
  { id: "threat", code: "E", name: "Threat Assessment Agent" },
  { id: "lead", code: "F", name: "Lead Investigator Agent" },
] as const;
export type AgentId = (typeof AGENTS)[number]["id"];

/**
 * Provenance of a statement shown in the UI. Every piece of displayed
 * intelligence carries one of these so users can tell a claim from a finding.
 */
export const PROVENANCE = {
  user_claim: { label: "User-submitted claim", tone: "neutral" },
  ai_assessment: { label: "AI-generated assessment", tone: "info" },
  deterministic: { label: "Computed (deterministic)", tone: "info" },
  corroborated: { label: "Independently corroborated", tone: "accent" },
  human_reviewed: { label: "Human-reviewed finding", tone: "accent" },
  official: { label: "Officially confirmed", tone: "accent" },
  synthetic: { label: "Synthetic demo data", tone: "warn" },
} as const;
export type Provenance = keyof typeof PROVENANCE;

export const EMERGENCY_DISCLAIMER =
  "GOS-IP is an information and situational awareness platform. It does not replace emergency services, official authorities or professional emergency response.";

export const AI_DISCLAIMER =
  "AI-generated assessments are not official emergency confirmations. They describe what submitted information suggests, with stated confidence, and may be wrong.";
