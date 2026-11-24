import { describe, expect, it } from "vitest";
import {
  assignClusterIds,
  connectedComponents,
  correlate,
  hammingHex,
  haversineKm,
  independentSourceCount,
  type CorrelationReport,
} from "@/lib/correlation/engine";

const base = new Date("2026-11-20T08:00:00Z");
const at = (minutes: number) => new Date(base.getTime() + minutes * 60_000);

function report(p: Partial<CorrelationReport> & { id: string }): CorrelationReport {
  return {
    reference: p.id,
    title: "Flooding on main road",
    description: "Water rising quickly on the main road near the market, cars stuck.",
    category: "flooding",
    locationText: "Bodija, Ibadan",
    latitude: 7.4352,
    longitude: 3.9133,
    occurredAt: base,
    submitterKey: `src-${p.id}`,
    evidence: [],
    ...p,
  };
}

const params = { radiusKm: 8, windowHours: 48, threshold: 0.55 };

describe("geometry", () => {
  it("computes haversine distance", () => {
    // Ibadan -> Lagos is roughly 110-125 km
    const d = haversineKm(7.3775, 3.947, 6.5244, 3.3792);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(125);
  });
  it("hamming distance of hex hashes", () => {
    expect(hammingHex("ffffffffffffffff", "ffffffffffffffff")).toBe(0);
    expect(hammingHex("0000000000000000", "000000000000000f")).toBe(4);
  });
});

describe("pair scoring", () => {
  it("links geographically and temporally close reports of the same category", () => {
    const a = report({ id: "a" });
    const b = report({
      id: "b",
      latitude: 7.4412,
      longitude: 3.9201,
      occurredAt: at(40),
      title: "Water levels rising in Agbowo",
      description: "Water rising fast near the main road, flooding houses near the stream.",
      locationText: "Agbowo, Ibadan",
    });
    const [s] = correlate(a, [b], params);
    expect(s.eligible).toBe(true);
    expect(s.type).toBe("corroborating");
    expect(s.score).toBeGreaterThanOrEqual(params.threshold);
    expect(s.explanation).toMatch(/within the 8 km radius/);
    expect(s.explanation).toMatch(/both are categorised as Flooding/);
  });

  it("does not link reports outside the radius, however similar", () => {
    const a = report({ id: "a" });
    const far = report({ id: "far", latitude: 6.5244, longitude: 3.3792 }); // Lagos
    const [s] = correlate(a, [far], params);
    expect(s.eligible).toBe(false);
    expect(s.rejectionReason).toMatch(/beyond the 8 km radius/);
  });

  it("does not link reports outside the time window", () => {
    const a = report({ id: "a" });
    const late = report({ id: "late", occurredAt: at(60 * 72) });
    const [s] = correlate(a, [late], params);
    expect(s.eligible).toBe(false);
    expect(s.rejectionReason).toMatch(/beyond the 48 h window/);
  });

  it("scores temporal proximity higher for closer times", () => {
    const a = report({ id: "a" });
    const [near] = correlate(a, [report({ id: "n", occurredAt: at(30) })], params);
    const [farT] = correlate(a, [report({ id: "f", occurredAt: at(60 * 40) })], params);
    expect(near.components.temporal).toBeGreaterThan(farT.components.temporal);
  });

  it("rejects unrelated categories with no descriptive overlap even when close", () => {
    const a = report({ id: "a" });
    const b = report({
      id: "b",
      category: "violence_security",
      title: "Armed robbery at shop",
      description: "Two men robbed a phone shop at gunpoint this evening.",
    });
    const [s] = correlate(a, [b], params);
    expect(s.eligible).toBe(false);
  });

  it("flags same-submitter reports as possible duplicates, not corroboration", () => {
    const a = report({ id: "a", submitterKey: "same" });
    const b = report({ id: "b", submitterKey: "same", occurredAt: at(5), latitude: 7.436 });
    const [s] = correlate(a, [b], params);
    expect(s.eligible).toBe(true);
    expect(s.type).toBe("possible_duplicate");
    expect(s.independent).toBe(false);
  });

  it("flags identical images as possible duplicates", () => {
    const ev = { id: "e1", sha256: "a".repeat(64), phash: "0f0f0f0f0f0f0f0f" };
    const a = report({ id: "a", evidence: [ev] });
    const b = report({
      id: "b",
      evidence: [{ ...ev, id: "e2" }],
      title: "Road flooded",
      description: "Heavy water on road near market, cannot pass.",
    });
    const [s] = correlate(a, [b], params);
    expect(s.imageMatches[0].kind).toBe("exact");
    expect(s.type).toBe("possible_duplicate");
  });

  it("does not penalise reports without imagery", () => {
    const a = report({ id: "a" });
    const [s] = correlate(a, [report({ id: "b", occurredAt: at(10) })], params);
    expect(s.components.evidence).toBeNull();
  });
});

describe("clustering", () => {
  it("builds connected components", () => {
    const comps = connectedComponents(["a", "b", "c", "d", "e"], [
      { a: "a", b: "b" },
      { a: "b", b: "c" },
      { a: "d", b: "e" },
    ]);
    expect(comps.map((c) => c.join(""))).toEqual(expect.arrayContaining(["abc", "de"]));
  });

  it("keeps cluster ids stable and separates incorrectly merged clusters", () => {
    const existing = new Map([
      ["a", "C1"],
      ["b", "C1"],
      ["c", "C1"],
      ["d", "C1"],
    ]);
    // reviewer split {a,b,c,d} into {a,b,c} and {d,e}
    const out = assignClusterIds([["a", "b", "c"], ["d", "e"]], existing);
    expect(out.find((o) => o.members.includes("a"))!.clusterId).toBe("C1");
    expect(out.find((o) => o.members.includes("e"))!.clusterId).toBeNull();
  });

  it("counts independent sources by submitter", () => {
    expect(
      independentSourceCount([
        { id: "1", submitterKey: "x" },
        { id: "2", submitterKey: "x" },
        { id: "3", submitterKey: "y" },
        { id: "4", submitterKey: null },
      ]),
    ).toBe(3);
  });
});
