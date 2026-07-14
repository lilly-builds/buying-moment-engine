import { describe, expect, it } from "vitest";
import {
  getTenantProfile,
  tenantProfileSchema,
  type TenantProfileInput,
} from "@/src/discovery/tenants";
import { PACK_VERTICALS } from "@/src/packs";
import { DETECTOR_KINDS } from "@/src/ingest/validate";

describe("getTenantProfile — the EliseAI profile", () => {
  it("parses, and every ICP vertical is a feed-reachable (non-unclassified) vertical (K7)", () => {
    const profile = getTenantProfile("eliseai");
    expect(profile.id).toBe("eliseai");
    expect(profile.metros.length).toBeGreaterThanOrEqual(50);
    expect(profile.rotation.cadenceDays).toBe(1);
    for (const entry of profile.icp) {
      expect(PACK_VERTICALS).toContain(entry.vertical);
    }
  });

  it("emits a real DetectorKind — the signal it stacks onto the feed", () => {
    const profile = getTenantProfile("eliseai");
    expect(DETECTOR_KINDS).toContain(profile.signalKind);
    expect(profile.signalKind).toBe("phone_complaints");
  });

  it("re-pull window matches the phone_complaints freshness window (90d)", () => {
    // Do not re-pay for a place more often than its emitted signal stays fresh.
    expect(getTenantProfile("eliseai").rePullWindowDays).toBe(90);
  });

  it("throws on an unknown tenant id", () => {
    expect(() => getTenantProfile("acme-co")).toThrow(/unknown tenant "acme-co"/);
  });
});

describe("tenantProfileSchema — fail loud on malformed data", () => {
  const valid: TenantProfileInput = {
    id: "t",
    metros: ["Austin, TX"],
    icp: [{ category: "dermatology", vertical: "dermatology" }],
    qualificationPrompt: "bad phone access",
    signalKind: "phone_complaints",
    ratingThreshold: 4.0,
    rePullWindowDays: 90,
    rotation: { anchorISO: "2026-01-05T00:00:00Z", cadenceDays: 7 },
  };

  it("accepts a well-formed profile", () => {
    expect(tenantProfileSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an empty qualificationPrompt", () => {
    expect(tenantProfileSchema.safeParse({ ...valid, qualificationPrompt: "" }).success).toBe(false);
  });

  it("rejects an empty metros list", () => {
    expect(tenantProfileSchema.safeParse({ ...valid, metros: [] }).success).toBe(false);
  });

  it("rejects an ICP vertical outside the feed-reachable set (e.g. unclassified)", () => {
    const bad = { ...valid, icp: [{ category: "x", vertical: "unclassified" }] };
    expect(tenantProfileSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a signalKind that is not a DetectorKind", () => {
    expect(tenantProfileSchema.safeParse({ ...valid, signalKind: "made_up" }).success).toBe(false);
  });
});
