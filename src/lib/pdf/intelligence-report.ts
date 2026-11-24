import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { AI_DISCLAIMER, EMERGENCY_DISCLAIMER, categoryLabel } from "@/lib/domain/constants";
import type { ReportDetail } from "@/lib/services/reports";

const PAGE = { w: 595.28, h: 841.89, margin: 48 };
const C = {
  ink: rgb(0.08, 0.1, 0.09),
  muted: rgb(0.38, 0.43, 0.4),
  accent: rgb(0.25, 0.45, 0.22),
  rule: rgb(0.8, 0.84, 0.81),
  warn: rgb(0.62, 0.38, 0.05),
  band: rgb(0.07, 0.09, 0.08),
};

/** Replace characters the standard PDF fonts cannot encode. */
function clean(font: PDFFont, text: string): string {
  const normalised = String(text ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/—|–/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ");
  let out = "";
  for (const ch of normalised) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}

class Writer {
  page!: PDFPage;
  y = 0;
  pageNo = 0;
  constructor(private doc: PDFDocument, private font: PDFFont, private bold: PDFFont, private header: string) {
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage([PAGE.w, PAGE.h]);
    this.pageNo += 1;
    this.page.drawRectangle({ x: 0, y: PAGE.h - 28, width: PAGE.w, height: 28, color: C.band });
    this.page.drawText("GOS-IP", { x: PAGE.margin, y: PAGE.h - 18, size: 9, font: this.bold, color: rgb(0.61, 0.8, 0.55) });
    this.page.drawText(clean(this.font, this.header), { x: PAGE.margin + 44, y: PAGE.h - 18, size: 8, font: this.font, color: rgb(0.8, 0.84, 0.81) });
    this.page.drawText(`Page ${this.pageNo}`, { x: PAGE.w - PAGE.margin - 40, y: PAGE.h - 18, size: 8, font: this.font, color: rgb(0.8, 0.84, 0.81) });
    this.page.drawText(clean(this.font, "AI-assisted assessment - not an official emergency confirmation"), {
      x: PAGE.margin, y: 24, size: 7, font: this.font, color: C.muted,
    });
    this.y = PAGE.h - 56;
  }

  ensure(h: number) {
    if (this.y - h < 48) this.newPage();
  }

  wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const words = clean(font, text).split(" ");
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) > width && line) {
        lines.push(line);
        line = w;
      } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  text(text: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}) {
    const size = opts.size ?? 9.5;
    const font = opts.bold ? this.bold : this.font;
    const indent = opts.indent ?? 0;
    const lines = this.wrap(text, font, size, PAGE.w - PAGE.margin * 2 - indent);
    for (const l of lines) {
      this.ensure(size + 4);
      this.page.drawText(l, { x: PAGE.margin + indent, y: this.y, size, font, color: opts.color ?? C.ink });
      this.y -= size + 3.5;
    }
    this.y -= opts.gap ?? 2;
  }

  heading(n: number, title: string) {
    this.ensure(34);
    this.y -= 8;
    this.page.drawText(clean(this.bold, `${n}. ${title.toUpperCase()}`), { x: PAGE.margin, y: this.y, size: 10, font: this.bold, color: C.accent });
    this.y -= 5;
    this.page.drawLine({ start: { x: PAGE.margin, y: this.y }, end: { x: PAGE.w - PAGE.margin, y: this.y }, thickness: 0.6, color: C.rule });
    this.y -= 13;
  }

  kv(key: string, value: string) {
    this.ensure(14);
    this.page.drawText(clean(this.bold, key), { x: PAGE.margin, y: this.y, size: 9, font: this.bold, color: C.muted });
    const lines = this.wrap(value, this.font, 9.5, PAGE.w - PAGE.margin * 2 - 150);
    for (const l of lines) {
      this.ensure(13);
      this.page.drawText(l, { x: PAGE.margin + 150, y: this.y, size: 9.5, font: this.font, color: C.ink });
      this.y -= 13;
    }
  }

  bullets(items: string[], empty = "None recorded.") {
    if (!items.length) return this.text(empty, { color: C.muted });
    for (const i of items) this.text(`- ${i}`, { indent: 8 });
  }
}

type Lead = {
  executive_summary?: string;
  severity?: { level: string; rationale: string };
  confidence?: { score: number; level: string; rationale: string };
  evidence_assessment?: string;
  corroboration_findings?: string;
  geographic_consistency?: string;
  conflicting_evidence?: { description: string; refs: string[] }[];
  unresolved_questions?: string[];
  recommended_next_steps?: { action: string; owner: string; priority: string }[];
  key_findings?: { statement: string; basis: string; refs: string[] }[];
  incident_classification?: { category: string; rationale: string };
};

export async function buildIntelligenceReportPdf(detail: ReportDetail): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const r = detail.report;
  doc.setTitle(`GOS-IP Intelligence Report ${r.reference}`);
  doc.setProducer("GOS-IP");
  doc.setCreator("GOS-IP Global Open-Source Situational Intelligence Platform");
  const w = new Writer(doc, font, bold, `Incident Intelligence Report  ${r.reference}`);

  w.text("Incident Intelligence Report", { size: 18, bold: true, gap: 4 });
  w.text(r.title, { size: 12, gap: 6 });
  if (r.is_synthetic) w.text("SYNTHETIC DEMONSTRATION DATA - this incident did not happen.", { bold: true, color: C.warn, gap: 6 });
  w.text(EMERGENCY_DISCLAIMER, { size: 8, color: C.muted });
  w.text(AI_DISCLAIMER, { size: 8, color: C.muted, gap: 8 });

  const inv = detail.investigation as unknown as (Record<string, unknown> & { summary: Lead | null; status: string; completed_at: string | null; model: string | null }) | null;
  const lead: Lead = (inv?.summary as Lead) ?? {};
  const generated = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";

  w.heading(1, "Reference");
  w.kv("Incident reference", r.reference);
  w.kv("Generated", generated);
  w.kv("Investigation status", inv ? `${inv.status}${inv.status === "partial" ? " (INCOMPLETE - some agents did not finish)" : ""}` : "No investigation recorded");
  if (inv?.model) w.kv("AI model", String(inv.model));

  w.heading(2, "Incident title");
  w.text(r.title);

  w.heading(3, "Incident category");
  w.kv("Submitted category", categoryLabel(r.category));
  if (lead.incident_classification) w.kv("AI assessed category", `${categoryLabel(lead.incident_classification.category)} - ${lead.incident_classification.rationale}`);

  w.heading(4, "Location");
  w.kv("Stated location", r.location_text);
  w.kv("Coordinates", r.latitude !== null ? `${r.latitude}, ${r.longitude} (${r.location_precision})` : "Not provided");

  w.heading(5, "Timeline");
  w.kv("Reported incident time", new Date(r.occurred_at).toISOString());
  w.kv("Submitted", new Date(r.submitted_at).toISOString());
  for (const e of (detail.timeline as unknown as { created_at: string; summary: string }[]).slice(-15)) {
    w.text(`${new Date(e.created_at).toISOString().slice(0, 16).replace("T", " ")}  ${e.summary}`, { size: 8.5, indent: 8 });
  }

  w.heading(6, "Original report description (user-submitted claim)");
  w.text(r.description);
  w.kv("Submitter", r.is_anonymous ? "Anonymous" : r.is_registered_reporter ? "Registered account" : "Unregistered");

  w.heading(7, "Related submissions");
  const rels = detail.relationships as unknown as { other_reference: string; relationship_type: string; score: number; explanation: string; status: string }[];
  w.kv("Related reports", String(rels.length));
  if (detail.cluster) {
    const c = detail.cluster as { reference: string; report_count: number; independent_source_count: number; explanation: string };
    w.kv("Incident cluster", `${c.reference} - ${c.report_count} reports, ${c.independent_source_count} independent sources`);
    w.text(c.explanation, { size: 8.5, color: C.muted });
  }
  for (const rel of rels.slice(0, 12)) {
    w.text(`${rel.other_reference} - ${rel.relationship_type.replace("_", " ")} (score ${Number(rel.score).toFixed(2)}${rel.status !== "active" ? `, ${rel.status.replace(/_/g, " ")}` : ""}): ${rel.explanation}`, { size: 8.5, indent: 8 });
  }

  w.heading(8, "Supporting evidence");
  const ev = detail.evidence as unknown as { id: string; file_kind: string; ai_relevance: string | null; metadata_flags: string[]; duplicate_kind: string | null; is_duplicate?: boolean; visible_summary?: string; ai_analysis?: { visible_summary?: string } }[];
  if (!ev.length) w.text("No evidence files were submitted.", { color: C.muted });
  for (const e of ev) {
    const summary = e.ai_analysis?.visible_summary ?? e.visible_summary ?? "";
    w.text(`Evidence ${e.id.slice(0, 8)} (${e.file_kind}) - relevance: ${e.ai_relevance ?? "not analysed"}${e.duplicate_kind || e.is_duplicate ? `; DUPLICATE (${e.duplicate_kind ?? "detected"})` : ""}${e.metadata_flags?.length ? `; flags: ${e.metadata_flags.join(", ")}` : ""}`, { size: 9, indent: 8 });
    if (summary) w.text(String(summary), { size: 8.5, indent: 16, color: C.muted });
  }
  w.text("Visual relevance does not establish authenticity, date or place of capture.", { size: 8, color: C.muted });

  w.heading(9, "AI investigation findings");
  if (!inv) w.text("No investigation has been run.", { color: C.muted });
  else if (!inv.summary) w.text(r.is_sensitive ? "Findings are withheld for sensitive reports outside authorised review." : "No synthesis is available for this investigation.", { color: C.muted });
  else {
    w.text(lead.executive_summary ?? "");
    for (const k of lead.key_findings ?? []) w.text(`- [${k.basis.replace("_", " ")}] ${k.statement} (sources: ${k.refs.join(", ")})`, { size: 9, indent: 8 });
  }

  w.heading(10, "Corroboration analysis");
  w.text(lead.corroboration_findings ?? "Not available.");

  w.heading(11, "Geographic analysis");
  w.text(lead.geographic_consistency ?? "Not available.");

  w.heading(12, "Severity assessment");
  w.kv("Severity", r.severity ?? "Not assessed");
  if (lead.severity) w.text(lead.severity.rationale, { size: 9 });

  w.heading(13, "Confidence assessment");
  w.kv("Confidence", r.confidence !== null ? `${Math.round(Number(r.confidence) * 100)}%${lead.confidence ? ` (${lead.confidence.level.replace("_", " ")})` : ""}` : "Not assessed");
  if (lead.confidence) w.text(lead.confidence.rationale, { size: 9 });
  w.text("Severity describes potential impact if the report is accurate; confidence describes how well-supported it is. They are independent.", { size: 8, color: C.muted });

  w.heading(14, "Conflicting information");
  w.bullets((lead.conflicting_evidence ?? []).map((c) => `${c.description} (sources: ${c.refs.join(", ")})`));

  w.heading(15, "Unresolved questions");
  w.bullets(lead.unresolved_questions ?? []);

  w.heading(16, "Recommended next steps");
  w.bullets((lead.recommended_next_steps ?? []).map((s) => `[${s.priority}] ${s.action} - ${s.owner.replace(/_/g, " ")}`));

  w.heading(17, "Human review status");
  w.kv("Verification status", r.verification_status);
  w.kv("Lifecycle", r.lifecycle_status);
  w.kv("Awaiting human review", r.needs_human_review ? "Yes" : "No");
  w.kv("Escalated by reviewer", r.priority_escalated ? "Yes" : "No");
  const reviews = detail.reviews as unknown as { decision: string; created_at: string; reviewer_name: string; notes: string | null }[];
  for (const rv of reviews.slice(0, 10)) {
    w.text(`${new Date(rv.created_at).toISOString().slice(0, 16).replace("T", " ")}  ${rv.decision} by ${rv.reviewer_name}${rv.notes ? `: ${rv.notes}` : ""}`, { size: 8.5, indent: 8 });
  }

  w.y -= 10;
  w.text("Provenance key: user claim = stated by a reporter only; AI assessment = model judgement; deterministic = computed by the platform; corroborated = supported by independent reports; human-reviewed = decided by an authorised reviewer.", { size: 7.5, color: C.muted });
  return doc.save();
}
