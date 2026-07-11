import { describe, expect, it } from "vitest";
import { joinClaimMetric } from "@/src/adapt/proof-format";

describe("joinClaimMetric", () => {
  it("does not double punctuation when the claim ends in a period", () => {
    const line = joinClaimMetric("Cut ramp time at a 200-person company.", "40% faster ramp");
    expect(line).toBe("Cut ramp time at a 200-person company: 40% faster ramp");
    expect(line).not.toContain(".:");
  });

  it("trims a trailing colon or semicolon before the separator", () => {
    expect(joinClaimMetric("Result:", "12% in 90 days")).toBe("Result: 12% in 90 days");
    expect(joinClaimMetric("Saved money;", "in year one")).toBe("Saved money: in year one");
  });

  it("joins a clean claim with a single separator", () => {
    expect(joinClaimMetric("Cut a carrier's fuel spend", "12% in 90 days")).toBe(
      "Cut a carrier's fuel spend: 12% in 90 days",
    );
  });

  it("returns the trimmed claim untouched when there is no metric", () => {
    expect(joinClaimMetric("We shipped on time.", "")).toBe("We shipped on time.");
    expect(joinClaimMetric("  padded claim  ", "   ")).toBe("padded claim");
  });

  it("falls back to the metric when the claim is only punctuation", () => {
    expect(joinClaimMetric("...", "40% faster")).toBe("40% faster");
  });
});
