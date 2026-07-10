import { describe, expect, it } from "vitest";
import { describeLeadValue, firstBriefHref } from "@/src/connect/connections";

/**
 * Thread 08 — RevOps onboarding. The Connections surface's pure logic is unit-
 * tested here (the repo has no component-render infra); the visual/interaction
 * pieces are verified by rendering /styleguide/integrations.
 *
 * This file grows with the units: U1 (opener numbers) first, then the checklist
 * status/go-live derivation and the ENGINE_KEYS↔KEY_SETUPS URL guard.
 */

describe("firstBriefHref (U1)", () => {
  it("points at the first feed row's real practice route", () => {
    expect(firstBriefHref([{ id: "prac_abc" }, { id: "prac_def" }])).toBe(
      "/practice/prac_abc",
    );
  });

  it("returns null for an empty feed so the opener degrades to the feed link", () => {
    expect(firstBriefHref([])).toBeNull();
  });
});

describe("describeLeadValue (U1)", () => {
  it("frames a real count with a plural noun phrase", () => {
    expect(describeLeadValue(12)).toEqual({
      hasLeads: true,
      count: 12,
      phrase: "12 hot leads",
    });
  });

  it("uses the singular for exactly one lead", () => {
    expect(describeLeadValue(1)).toEqual({
      hasLeads: true,
      count: 1,
      phrase: "1 hot lead",
    });
  });

  it("returns the honest no-number state for zero (never a fake tally)", () => {
    expect(describeLeadValue(0)).toEqual({
      hasLeads: false,
      count: 0,
      phrase: "",
    });
  });

  it("defends against NaN / negative counts", () => {
    expect(describeLeadValue(Number.NaN).hasLeads).toBe(false);
    expect(describeLeadValue(-3).hasLeads).toBe(false);
  });
});
