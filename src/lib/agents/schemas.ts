import { z } from "zod";
import { CATEGORY_IDS, SEVERITIES } from "@/lib/domain/constants";

/**
 * Structured output contracts for each investigation agent. These schemas are
 * sent to the model as JSON schemas AND used to validate what comes back.
 */

const confidence = z.number().min(0).max(1).describe("0 = no confidence, 1 = certain");

export const classificationSchema = z.object({
  incident_summary: z.string().describe("Neutral 1-3 sentence restatement of what the reporter claims. Attribute claims to the reporter."),
  category_assessment: z.object({
    assessed_category: z.enum(CATEGORY_IDS),
    agrees_with_submission: z.boolean(),
    rationale: z.string(),
  }),
  entities: z
    .array(
      z.object({
        type: z.enum(["place", "infrastructure", "organization", "group_of_people", "vehicle", "hazard", "other"]),
        text: z.string(),
        note: z.string(),
      }),
    )
    .describe("Never include names of private individuals; describe them by role instead."),
  locations_mentioned: z.array(z.object({ text: z.string(), role: z.enum(["primary", "secondary", "landmark"]) })),
  time_references: z.array(z.object({ text: z.string(), interpretation: z.string() })),
  urgent_indicators: z.array(z.object({ indicator: z.string(), quote: z.string() })),
  people_at_risk_mentioned: z.boolean(),
  claims: z.array(
    z.object({
      claim: z.string(),
      basis: z.enum(["direct_observation", "hearsay", "opinion", "unclear"]),
      quote: z.string(),
    }),
  ),
  information_gaps: z.array(z.string()),
});
export type ClassificationOutput = z.infer<typeof classificationSchema>;

export const evidenceSchema = z.object({
  items: z.array(
    z.object({
      evidence_id: z.string(),
      visible_summary: z.string().describe("What is visibly depicted. No speculation about identity of people."),
      observed_elements: z.array(z.string()),
      environmental_conditions: z.array(z.string()),
      relevance: z.enum(["relevant", "partially_relevant", "unrelated", "inconclusive"]),
      relevance_rationale: z.string(),
      consistent_with_report: z.array(z.string()),
      inconsistencies: z.array(z.string()),
      authenticity_statement: z
        .string()
        .describe("Must state that visual relevance does not establish authenticity, date or location of capture."),
      quality_issues: z.array(z.string()),
      sensitive_content: z.object({
        identifiable_people: z.boolean(),
        possible_minors: z.boolean(),
        graphic_content: z.boolean(),
      }),
    }),
  ),
  overall_assessment: z.string(),
  uncertainties: z.array(z.string()),
});
export type EvidenceOutput = z.infer<typeof evidenceSchema>;

export const geospatialSchema = z.object({
  location_consistency: z.enum(["consistent", "partially_consistent", "inconsistent", "insufficient_information"]),
  rationale: z.string(),
  place_names_in_description: z.array(z.string()),
  concerns: z.array(z.string()),
  nearby_context_summary: z.string(),
  recommended_public_precision: z.enum(["precise", "approximate"]),
  precision_rationale: z.string(),
});
export type GeospatialOutput = z.infer<typeof geospatialSchema>;

export const corroborationSchema = z.object({
  assessments: z.array(
    z.object({
      report_reference: z.string(),
      relationship: z.enum(["corroborates", "partially_corroborates", "unrelated", "conflicts", "possible_duplicate"]),
      independence: z.enum(["likely_independent", "possibly_same_source", "same_source", "unknown"]),
      matching_details: z.array(z.string()),
      conflicting_details: z.array(z.string()),
      rationale: z.string(),
    }),
  ),
  overall_corroboration: z.enum(["strong", "moderate", "weak", "none", "conflicting"]),
  summary: z.string(),
});
export type CorroborationOutput = z.infer<typeof corroborationSchema>;

export const threatSchema = z.object({
  severity: z.enum(SEVERITIES),
  severity_rationale: z.string(),
  immediate_danger: z.enum(["yes", "possible", "no", "unknown"]),
  danger_factors: z.array(z.string()),
  urgency: z.enum(["immediate", "within_hours", "within_days", "monitor"]),
  recommended_priority: z.enum(SEVERITIES),
  affected_population: z.string().describe("Qualitative description, or 'unknown'. Do not invent numbers."),
  assessment_confidence: confidence,
  confidence_rationale: z.string(),
  escalation_recommended: z.boolean(),
});
export type ThreatOutput = z.infer<typeof threatSchema>;

const findingRef = z
  .string()
  .describe("Reference to the source of a statement, e.g. 'report', 'classification', 'evidence:<id>', 'geospatial', 'corroboration:<reference>', 'threat'.");

export const leadSchema = z.object({
  executive_summary: z.string(),
  incident_classification: z.object({ category: z.enum(CATEGORY_IDS), rationale: z.string() }),
  severity: z.object({ level: z.enum(SEVERITIES), rationale: z.string() }),
  evidence_assessment: z.string(),
  corroboration_findings: z.string(),
  geographic_consistency: z.string(),
  confidence: z.object({
    score: confidence,
    level: z.enum(["very_low", "low", "moderate", "high"]),
    rationale: z.string(),
  }),
  key_findings: z.array(
    z.object({
      statement: z.string(),
      basis: z.enum(["user_claim", "ai_assessment", "deterministic", "corroborated"]),
      refs: z.array(findingRef),
    }),
  ),
  conflicting_evidence: z.array(z.object({ description: z.string(), refs: z.array(findingRef) })),
  unresolved_questions: z.array(z.string()),
  recommended_next_steps: z.array(
    z.object({
      action: z.string(),
      owner: z.enum(["human_reviewer", "emergency_responders", "reporter", "community", "platform"]),
      priority: z.enum(["now", "soon", "later"]),
    }),
  ),
  requires_human_review: z.boolean(),
  human_review_reasons: z.array(z.string()),
});
export type LeadOutput = z.infer<typeof leadSchema>;
