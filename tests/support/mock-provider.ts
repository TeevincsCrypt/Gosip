import type { AIProvider, StructuredRequest } from "@/lib/ai/provider";

/**
 * Test double for the AI provider. Returns schema-shaped fixtures per agent so
 * the orchestration, persistence and failure handling can be tested offline.
 * Never used by the application at runtime.
 */
export function mockProvider(overrides: Partial<Record<string, (req: StructuredRequest<unknown>) => unknown>> = {}): AIProvider & { calls: string[] } {
  const fixtures: Record<string, (req: StructuredRequest<unknown>) => unknown> = {
    classification: () => ({
      incident_summary: "The reporter states that flood water is rising near a market.",
      category_assessment: { assessed_category: "flooding", agrees_with_submission: true, rationale: "Describes rising water." },
      entities: [{ type: "place", text: "market", note: "landmark" }],
      locations_mentioned: [{ text: "Bodija", role: "primary" }],
      time_references: [],
      urgent_indicators: [],
      people_at_risk_mentioned: false,
      claims: [{ claim: "Water is rising", basis: "direct_observation", quote: "water rising" }],
      information_gaps: ["Depth of water"],
    }),
    evidence: (req) => {
      const ids = req.content.filter((c) => c.type === "text" && c.text.startsWith("Image evidence_id=")).map((c) => (c as { text: string }).text.split("=")[1].split(" ")[0]);
      return {
        items: ids.map((id) => ({
          evidence_id: id,
          visible_summary: "Abstract test image.",
          observed_elements: ["shapes"],
          environmental_conditions: [],
          relevance: "inconclusive",
          relevance_rationale: "Synthetic test image.",
          consistent_with_report: [],
          inconsistencies: [],
          authenticity_statement: "Visual relevance does not establish authenticity.",
          quality_issues: [],
          sensitive_content: { identifiable_people: false, possible_minors: false, graphic_content: false },
        })),
        overall_assessment: "Inconclusive.",
        uncertainties: [],
      };
    },
    geospatial: () => ({
      location_consistency: "consistent",
      rationale: "Place names match.",
      place_names_in_description: ["Bodija"],
      concerns: [],
      nearby_context_summary: "Several nearby flood reports.",
      recommended_public_precision: "precise",
      precision_rationale: "Non-sensitive.",
    }),
    corroboration: () => ({ assessments: [], overall_corroboration: "moderate", summary: "Nearby reports describe similar flooding." }),
    threat: () => ({
      severity: "HIGH",
      severity_rationale: "Rising water near homes.",
      immediate_danger: "possible",
      danger_factors: ["rising water"],
      urgency: "within_hours",
      recommended_priority: "HIGH",
      affected_population: "unknown",
      assessment_confidence: 0.6,
      confidence_rationale: "Multiple reports.",
      escalation_recommended: false,
    }),
    lead: () => ({
      executive_summary: "Multiple reports suggest localised flooding.",
      incident_classification: { category: "flooding", rationale: "Consistent descriptions." },
      severity: { level: "HIGH", rationale: "Water entering homes." },
      evidence_assessment: "No conclusive imagery.",
      corroboration_findings: "Moderate.",
      geographic_consistency: "Consistent.",
      confidence: { score: 0.62, level: "moderate", rationale: "Independent reports, no imagery." },
      key_findings: [{ statement: "Water rising near market", basis: "user_claim", refs: ["report"] }],
      conflicting_evidence: [],
      unresolved_questions: ["How deep is the water?"],
      recommended_next_steps: [{ action: "Contact local emergency management", owner: "human_reviewer", priority: "now" }],
      requires_human_review: true,
      human_review_reasons: ["High severity"],
    }),
  };
  const p = {
    name: "mock",
    model: "mock-model",
    calls: [] as string[],
    async generateStructured<T>(req: StructuredRequest<T>) {
      p.calls.push(req.agent);
      const fn = overrides[req.agent] ?? fixtures[req.agent];
      const data = await fn(req as StructuredRequest<unknown>);
      return { data: data as T, model: "mock-model", tokensIn: 10, tokensOut: 20 };
    },
  };
  return p;
}
