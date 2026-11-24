import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { resetDatabase } from "../support/db";
import { testImage } from "../support/fixtures";
import { mockProvider } from "../support/mock-provider";
import { closeSql, getSql } from "@/lib/db/client";
import { withActor, withSystem, type Actor } from "@/lib/db/context";
import { createReport, getReportDetail, listReports, SubmissionError } from "@/lib/services/reports";
import { correlateReport } from "@/lib/services/correlation";
import { runInvestigation } from "@/lib/services/investigation";
import { applyReviewAction } from "@/lib/services/review";
import { getDashboardStats } from "@/lib/services/insights";
import { reportSubmissionSchema, type ReportSubmission } from "@/lib/domain/schemas";

const anon: Actor = { kind: "anonymous" };
let analyst: Actor;
let reporter: Actor;
let otherReporter: Actor;

async function makeUser(role: "reporter" | "analyst" | "admin"): Promise<Actor> {
  const id = randomUUID();
  await getSql()`insert into public.profiles (id, email, display_name, role) values (${id}, ${`${id}@test.local`}, ${role}, ${role})`;
  return { kind: "user", userId: id, role };
}

function submission(p: Partial<ReportSubmission> = {}): ReportSubmission {
  return reportSubmissionSchema.parse({
    title: "Flooding near Bodija market",
    description: "Water has covered the road near Bodija market and is entering shops and homes.",
    category: "flooding",
    locationText: "Bodija, Ibadan",
    latitude: 7.4352,
    longitude: 3.9133,
    locationSource: "map",
    occurredAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    anonymous: false,
    ...p,
  });
}

beforeAll(async () => {
  await resetDatabase();
  analyst = await makeUser("analyst");
  reporter = await makeUser("reporter");
  otherReporter = await makeUser("reporter");
});

afterAll(async () => {
  await closeSql();
});

describe("community reporting", () => {
  it("accepts an anonymous submission with evidence and hides identity", async () => {
    const created = await createReport(
      anon,
      submission({ anonymous: true, contactEmail: "someone@example.com" }),
      [{ name: "photo.jpg", type: "image/jpeg", data: await testImage(1) }],
      { fingerprint: "fp-anon-1" },
    );
    expect(created.reference).toMatch(/^GSP-\d{6}-[0-9A-F]{6}$/);
    expect(created.evidenceCount).toBe(1);
    expect(created.investigationStatus).toBe("not_configured");
    const [row] = await getSql()`select is_anonymous, reporter_id, contact_email from public.reports where id = ${created.id}`;
    expect(row.is_anonymous).toBe(true);
    expect(row.reporter_id).toBeNull();
    expect(row.contact_email).toBeNull(); // anonymous reports never store contact details
  });

  it("rejects unsupported uploads without creating a report", async () => {
    const before = (await getSql()`select count(*)::int as c from public.reports`)[0].c;
    await expect(
      createReport(anon, submission(), [{ name: "evil.jpg", type: "image/jpeg", data: Buffer.from("<script>alert(1)</script> padding padding") }], { fingerprint: null }),
    ).rejects.toBeInstanceOf(SubmissionError);
    const after = (await getSql()`select count(*)::int as c from public.reports`)[0].c;
    expect(after).toBe(before);
  });

  it("detects duplicate evidence across reports", async () => {
    const img = await testImage(42);
    await createReport(anon, submission({ title: "Flood photo one" }), [{ name: "a.jpg", type: "image/jpeg", data: img }], { fingerprint: "fp-dup-a" });
    const second = await createReport(anon, submission({ title: "Flood photo two" }), [{ name: "b.jpg", type: "image/jpeg", data: img }], { fingerprint: "fp-dup-b" });
    expect(second.duplicateEvidence).toBe(1);
  });

  it("links a registered reporter and lets them read their own report", async () => {
    const created = await createReport(reporter, submission({ contactPhone: "+234000000" }), [], { fingerprint: "fp-r1" });
    const mine = await getReportDetail(reporter, created.id);
    expect(mine?.isOwnReport).toBe(true);
    expect(mine?.staff).toBeNull(); // not staff
  });
});

describe("database security (RLS)", () => {
  it("anonymous users cannot read raw reports or evidence", async () => {
    const rows = await withActor(anon, (tx) => tx`select count(*)::int as c from public.reports`).catch((e: Error) => e);
    expect(rows).toBeInstanceOf(Error); // no SELECT privilege at all
    expect(String(rows)).toMatch(/permission denied/);
    const evidence = await withActor(anon, (tx) => tx`select * from public.evidence`).catch((e: Error) => e);
    expect(evidence).toBeInstanceOf(Error);
  });

  it("public view never exposes contact details or reporter identity", async () => {
    const cols = await withActor(anon, (tx) => tx`select * from public.reports_public limit 1`);
    expect(Object.keys(cols[0])).not.toEqual(expect.arrayContaining(["contact_email"]));
    expect(Object.keys(cols[0])).not.toContain("reporter_id");
    expect(Object.keys(cols[0])).not.toContain("submitter_fingerprint");
  });

  it("other reporters cannot read someone else's contact details", async () => {
    const created = await createReport(reporter, submission({ contactPhone: "+234111111" }), [], { fingerprint: "fp-r2" });
    const rows = await withActor(otherReporter, (tx) => tx`select contact_phone from public.reports where id = ${created.id}`);
    expect(rows).toHaveLength(0);
    const staffRows = await withActor(analyst, (tx) => tx`select contact_phone from public.reports where id = ${created.id}`);
    expect(staffRows[0].contact_phone).toBe("+234111111");
  });

  it("reporters cannot self-verify or update reports", async () => {
    const created = await createReport(reporter, submission(), [], { fingerprint: "fp-r3" });
    const updated = await withActor(reporter, (tx) => tx`update public.reports set verification_status = 'verified' where id = ${created.id} returning id`).catch((e: Error) => e);
    // Either RLS filters the row (0 updated) or privileges reject it.
    if (!(updated instanceof Error)) expect(updated).toHaveLength(0);
    const [row] = await getSql()`select verification_status from public.reports where id = ${created.id}`;
    expect(row.verification_status).toBe("unverified");
  });

  it("cannot submit a pre-verified or synthetic report through the API role", async () => {
    const err = await withActor(anon, (tx) => tx`
      insert into public.reports (id, reference, title, description, category, location_text, occurred_at, verification_status, is_anonymous)
      values (${randomUUID()}, ${"GSP-X-" + Date.now()}, 'Fake verified report', 'This should never be accepted by policy.', 'fire', 'Somewhere', now(), 'verified', true)`).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
  });

  it("AI/system code cannot verify or resolve; a human reviewer can", async () => {
    const created = await createReport(reporter, submission(), [], { fingerprint: "fp-r4" });
    const err = await withSystem("agent", (tx) => tx`update public.reports set verification_status = 'verified' where id = ${created.id}`).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String(err)).toMatch(/Only a human reviewer/);
    const res = await applyReviewAction(analyst, { action: "verify", reportId: created.id, notes: "Confirmed with local authority" });
    expect(res.ok).toBe(true);
    const [row] = await getSql()`select verification_status from public.reports where id = ${created.id}`;
    expect(row.verification_status).toBe("verified");
    const audit = await getSql()`select action, previous_state, new_state from public.audit_logs where entity_id = ${created.id}`;
    expect(audit[0].action).toBe("verify");
    expect(audit[0].previous_state.verification_status).toBe("unverified");
    expect(audit[0].new_state.verification_status).toBe("verified");
  });

  it("non-staff cannot perform review actions", async () => {
    await expect(applyReviewAction(reporter, { action: "verify", reportId: randomUUID() })).rejects.toThrow(/Reviewer role required/);
  });

  it("audit log is append-only", async () => {
    const err = await getSql()`update public.audit_logs set action = 'tampered'`.catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
  });

  it("coarsens coordinates of sensitive reports in the public view", async () => {
    const created = await createReport(anon, submission({ category: "violence_security", title: "Gunshots heard near junction", description: "Several gunshots heard near the junction, people running away.", latitude: 7.123456, longitude: 3.987654, anonymous: true }), [], { fingerprint: "fp-s1" });
    const [pub] = await withActor(anon, (tx) => tx`select latitude, longitude, location_precision from public.reports_public where id = ${created.id}`);
    expect(pub.location_precision).toBe("approximate");
    expect(Number(pub.latitude)).toBe(7.12);
    expect(Number(pub.longitude)).toBe(3.99);
  });
});

describe("cross-report intelligence", () => {
  const ids: string[] = [];

  it("clusters five independent nearby flood reports", async () => {
    const t = Date.now() - 6 * 3600_000;
    const points: [number, number, string, string][] = [
      [7.4352, 3.9133, "Flooding near Bodija market", "Flood water covering the road near Bodija market, shops flooded."],
      [7.4433, 3.9047, "Water levels rising in Agbowo", "Water levels rising fast near the stream in Agbowo, houses at risk of flooding."],
      [7.4300, 3.9200, "Road blocked by flood water", "Road access blocked by flood water near Bodija, cars cannot pass."],
      [7.4480, 3.9150, "Heavy rainfall and water accumulation", "Heavy rainfall since morning, water accumulating and flooding the streets."],
      [7.4390, 3.9010, "Residential flooding in UI area", "Several homes flooded, residents moving belongings, water still rising."],
    ];
    // Separate, far away test reports should not join.
    await createReport(anon, submission({ title: "Flooding in Lagos Island", latitude: 6.4541, longitude: 3.3947, locationText: "Lagos Island", anonymous: true }), [], { fingerprint: "fp-lagos" });
    for (const [i, [lat, lng, title, description]] of points.entries()) {
      const r = await createReport(anon, submission({ title, description, latitude: lat, longitude: lng, occurredAt: new Date(t + i * 25 * 60_000), anonymous: true, locationText: "Ibadan" }), [], { fingerprint: `fp-cluster-${i}` });
      ids.push(r.id);
      await correlateReport(r.id);
    }
    const memberships = await getSql()`select cluster_id, count(*)::int as n from public.cluster_relationships where report_id in ${getSql()(ids)} and status = 'active' group by cluster_id`;
    expect(memberships).toHaveLength(1);
    expect(memberships[0].n).toBe(5);
    const [cluster] = await getSql()`select report_count, independent_source_count, explanation from public.incident_clusters where id = ${memberships[0].cluster_id}`;
    expect(cluster.report_count).toBeGreaterThanOrEqual(5);
    expect(cluster.independent_source_count).toBeGreaterThanOrEqual(5);
    expect(cluster.explanation).toMatch(/threshold/);
    const statuses = await getSql()`select verification_status from public.reports where id in ${getSql()(ids)}`;
    expect(statuses.every((s) => s.verification_status === "corroborated")).toBe(true);
    const rel = await getSql()`select explanation from public.report_relationships where report_a = ${[ids[0], ids[1]].sort()[0]} and report_b = ${[ids[0], ids[1]].sort()[1]}`;
    expect(rel[0]?.explanation).toMatch(/km|m apart/);
  });

  it("keeps an unrelated far-away report out of the cluster", async () => {
    const [lagos] = await getSql()`select id from public.reports where location_text = 'Lagos Island'`;
    const m = await getSql()`select 1 from public.cluster_relationships where report_id = ${lagos.id} and status = 'active'`;
    expect(m).toHaveLength(0);
  });

  it("lets a reviewer separate an incorrectly clustered report", async () => {
    const [{ cluster_id }] = await getSql()`select cluster_id from public.cluster_relationships where report_id = ${ids[4]} and status = 'active'`;
    await applyReviewAction(analyst, { action: "separate", reportId: ids[4], clusterId: cluster_id, notes: "Different event" });
    const m = await getSql()`select 1 from public.cluster_relationships where report_id = ${ids[4]} and status = 'active'`;
    expect(m).toHaveLength(0);
    // re-running correlation must not undo the human decision
    await correlateReport(ids[4]);
    const again = await getSql()`select 1 from public.cluster_relationships where report_id = ${ids[4]} and status = 'active'`;
    expect(again).toHaveLength(0);
  });

  it("dashboard statistics come from database rows", async () => {
    const stats = await getDashboardStats(anon);
    const [{ c }] = await getSql()`select count(*)::int as c from public.reports where verification_status <> 'rejected' and public_visibility <> 'hidden'`;
    expect(stats.counts.total).toBe(c);
    expect(stats.clusters.active).toBeGreaterThanOrEqual(1);
    const list = await listReports(anon, { category: ["flooding"] });
    expect(list.items.every((r) => r.category === "flooding")).toBe(true);
  });
});

describe("AI investigation orchestration", () => {
  it("records not_configured honestly when no provider is set", async () => {
    const r = await createReport(anon, submission({ anonymous: true }), [], { fingerprint: "fp-nc" });
    const out = await runInvestigation(r.id, { provider: null });
    expect(out.status).toBe("not_configured");
    const [inv] = await getSql()`select status, summary from public.investigations where id = ${out.investigationId}`;
    expect(inv.status).toBe("not_configured");
    expect(inv.summary).toBeNull();
    const findings = await getSql()`select 1 from public.agent_findings where investigation_id = ${out.investigationId}`;
    expect(findings).toHaveLength(0);
  });

  it("runs all six agents and persists structured findings", async () => {
    const r = await createReport(anon, submission({ anonymous: true }), [{ name: "p.jpg", type: "image/jpeg", data: await testImage(77) }], { fingerprint: "fp-ok" });
    const provider = mockProvider();
    const out = await runInvestigation(r.id, { provider });
    expect(out.status).toBe("completed");
    expect(provider.calls).toEqual(expect.arrayContaining(["classification", "evidence", "geospatial", "corroboration", "threat", "lead"]));
    const findings = await getSql()`select agent, status, output from public.agent_findings where investigation_id = ${out.investigationId}`;
    expect(findings).toHaveLength(6);
    expect(findings.every((f) => f.status === "succeeded")).toBe(true);
    const [rep] = await getSql()`select investigation_status, severity, confidence, needs_human_review, verification_status from public.reports where id = ${r.id}`;
    expect(rep.investigation_status).toBe("completed");
    expect(rep.severity).toBe("HIGH");
    expect(Number(rep.confidence)).toBeCloseTo(0.62);
    expect(rep.needs_human_review).toBe(true);
    expect(rep.verification_status).not.toBe("verified"); // AI never verifies
    const [ev] = await getSql()`select ai_relevance from public.evidence where report_id = ${r.id}`;
    expect(ev.ai_relevance).toBe("inconclusive");
  });

  it("preserves other findings and marks the investigation partial when an agent fails", async () => {
    const r = await createReport(anon, submission({ anonymous: true }), [], { fingerprint: "fp-partial" });
    const provider = mockProvider({ geospatial: () => ({ invalid: true }) });
    const out = await runInvestigation(r.id, { provider });
    expect(out.status).toBe("partial");
    const findings = await getSql()`select agent, status, error from public.agent_findings where investigation_id = ${out.investigationId}`;
    const geo = findings.find((f) => f.agent === "geospatial")!;
    expect(geo.status).toBe("failed");
    expect(geo.error).toMatch(/schema validation|Invalid/);
    expect(findings.find((f) => f.agent === "lead")!.status).toBe("succeeded");
    const events = await getSql()`select event_type from public.incident_events where investigation_id = ${out.investigationId}`;
    expect(events.map((e) => e.event_type)).toContain("investigation_partial");
  });

  it("reports failure when nothing could be synthesised and supports retry", async () => {
    const r = await createReport(anon, submission({ anonymous: true }), [], { fingerprint: "fp-fail" });
    const broken = mockProvider({
      classification: () => { throw new Error("boom"); },
      threat: () => { throw new Error("boom"); },
      geospatial: () => { throw new Error("boom"); },
      corroboration: () => { throw new Error("boom"); },
    });
    const out = await runInvestigation(r.id, { provider: broken });
    expect(out.status).toBe("failed");
    const retry = await runInvestigation(r.id, { provider: mockProvider(), trigger: "retry" });
    expect(retry.status).toBe("completed");
    const invs = await getSql()`select attempt, status from public.investigations where report_id = ${r.id} order by attempt`;
    expect(invs.map((i) => i.status)).toEqual(["failed", "completed"]);
  });

  it("withholds findings of sensitive reports from the public", async () => {
    const r = await createReport(anon, submission({ category: "violence_security", title: "Gunshots near the junction", description: "Gunshots heard near the junction; people running.", anonymous: true }), [], { fingerprint: "fp-sens" });
    await runInvestigation(r.id, { provider: mockProvider() });
    const pub = await getReportDetail(anon, r.id);
    expect(pub?.investigation?.summary).toBeNull();
    expect(pub?.findings.every((f) => f.output === null)).toBe(true);
    const staff = await getReportDetail(analyst, r.id);
    expect(staff?.investigation?.summary).not.toBeNull();
  });
});
