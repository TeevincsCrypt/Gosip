import { describe, expect, it } from "vitest";
import { reportSubmissionSchema } from "@/lib/domain/schemas";

const valid = {
  title: "Flooding near Bodija market",
  description: "Water has covered the road near the market and is entering shops.",
  category: "flooding",
  locationText: "Bodija Market, Ibadan",
  latitude: 7.4352,
  longitude: 3.9133,
  locationSource: "map",
  occurredAt: new Date(Date.now() - 3600_000).toISOString(),
  anonymous: false,
};

describe("report submission validation", () => {
  it("accepts a valid report", () => {
    expect(reportSubmissionSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const r = reportSubmissionSchema.safeParse({ ...valid, title: "", description: undefined, category: undefined });
    expect(r.success).toBe(false);
    const fields = r.error!.issues.map((i) => i.path[0]);
    expect(fields).toEqual(expect.arrayContaining(["title", "description", "category"]));
  });

  it("rejects out-of-range coordinates", () => {
    const r = reportSubmissionSchema.safeParse({ ...valid, latitude: 123, longitude: 400 });
    expect(r.success).toBe(false);
    expect(r.error!.issues.some((i) => /Latitude/.test(i.message))).toBe(true);
  });

  it("rejects half-specified coordinates and null island", () => {
    expect(reportSubmissionSchema.safeParse({ ...valid, longitude: null }).success).toBe(false);
    expect(reportSubmissionSchema.safeParse({ ...valid, latitude: 0, longitude: 0 }).success).toBe(false);
  });

  it("rejects future incident times", () => {
    const r = reportSubmissionSchema.safeParse({ ...valid, occurredAt: new Date(Date.now() + 86400_000).toISOString() });
    expect(r.success).toBe(false);
  });

  it("allows reports without coordinates", () => {
    expect(reportSubmissionSchema.safeParse({ ...valid, latitude: null, longitude: null, locationSource: "manual" }).success).toBe(true);
  });

  it("validates optional contact email", () => {
    expect(reportSubmissionSchema.safeParse({ ...valid, contactEmail: "not-an-email" }).success).toBe(false);
    expect(reportSubmissionSchema.safeParse({ ...valid, contactEmail: "" }).success).toBe(true);
  });
});
