import { describe, expect, it } from "vitest";
import { selectMetro, selectMetroBatch } from "@/src/discovery/rotation";
import { tenantProfileSchema, type TenantProfile } from "@/src/discovery/tenants";

const DAY_MS = 24 * 60 * 60 * 1000;
const ANCHOR = "2026-01-05T00:00:00Z"; // a Monday

function tenant(metros: string[]): TenantProfile {
  return tenantProfileSchema.parse({
    id: "t",
    metros,
    icp: [{ category: "dermatology", vertical: "dermatology" }],
    qualificationPrompt: "phone access pain",
    signalKind: "phone_complaints",
    ratingThreshold: 4.0,
    rePullWindowDays: 90,
    rotation: { anchorISO: ANCHOR, cadenceDays: 7 },
  });
}

const THREE = tenant(["Austin, TX", "Tampa, FL", "Charlotte, NC"]);

function at(daysAfterAnchor: number): Date {
  return new Date(new Date(ANCHOR).getTime() + daysAfterAnchor * DAY_MS);
}

describe("selectMetro", () => {
  it("returns the first metro at the anchor, and advances one per cadence window", () => {
    expect(selectMetro(THREE, at(0))).toBe("Austin, TX");
    expect(selectMetro(THREE, at(7))).toBe("Tampa, FL");
    expect(selectMetro(THREE, at(14))).toBe("Charlotte, NC");
  });

  it("wraps around at the end of the list", () => {
    expect(selectMetro(THREE, at(21))).toBe("Austin, TX");
    expect(selectMetro(THREE, at(28))).toBe("Tampa, FL");
  });

  it("is STABLE within a single cadence window (any day of the week -> same metro)", () => {
    expect(selectMetro(THREE, at(7))).toBe("Tampa, FL");
    expect(selectMetro(THREE, at(10))).toBe("Tampa, FL");
    expect(selectMetro(THREE, at(13))).toBe("Tampa, FL");
  });

  it("a single-metro profile always returns that metro (R9)", () => {
    const solo = tenant(["Austin, TX"]);
    expect(selectMetro(solo, at(0))).toBe("Austin, TX");
    expect(selectMetro(solo, at(99))).toBe("Austin, TX");
  });

  it("handles a `now` before the anchor without a negative index", () => {
    expect(selectMetro(THREE, at(-7))).toBe("Charlotte, NC");
    expect(selectMetro(THREE, at(-1))).toBe("Charlotte, NC");
  });

  it("selects a rotating daily batch without exceeding the metro list", () => {
    const daily = tenant([
      "New York, NY",
      "Los Angeles, CA",
      "Chicago, IL",
      "Houston, TX",
      "Phoenix, AZ",
    ]);
    daily.rotation.cadenceDays = 1;
    expect(selectMetroBatch(daily, at(0), 3)).toEqual([
      "New York, NY",
      "Los Angeles, CA",
      "Chicago, IL",
    ]);
    expect(selectMetroBatch(daily, at(1), 3)).toEqual([
      "Houston, TX",
      "Phoenix, AZ",
      "New York, NY",
    ]);
    expect(selectMetroBatch(daily, at(2), 99)).toHaveLength(5);
  });
});
