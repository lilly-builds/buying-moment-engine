import { describe, expect, it } from "vitest";
import {
  clampConfidence,
  compareByScore,
  decayedScore,
  type ScoreInput,
} from "@/src/engine/scoring";
import { computeExpiresAt } from "@/src/engine/freshness";

describe("clampConfidence", () => {
  it("clamps into [0,1] and coerces NaN/Inf to 0", () => {
    expect(clampConfidence(0.5)).toBe(0.5);
    expect(clampConfidence(-0.2)).toBe(0);
    expect(clampConfidence(1.4)).toBe(1);
    expect(clampConfidence(Number.NaN)).toBe(0);
    expect(clampConfidence(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("decayedScore", () => {
  it("multiplies clamped confidence by freshness weight", () => {
    const detectedAt = new Date("2026-07-01T00:00:00Z");
    const expiresAt = computeExpiresAt("staffing_spike", detectedAt); // +30d
    // Halfway through the window -> weight 0.5.
    const score = decayedScore({
      confidence: 0.8,
      detectedAt,
      expiresAt,
      now: new Date("2026-07-16T00:00:00Z"),
    });
    expect(score).toBeCloseTo(0.4, 10);
  });
});

describe("a signal past the freshness window decays in rank", () => {
  const now = new Date("2026-07-05T00:00:00Z");

  // Lower raw confidence, but freshly detected and inside its window.
  const fresh: ScoreInput = {
    confidence: 0.6,
    detectedAt: new Date("2026-07-01T00:00:00Z"),
    expiresAt: computeExpiresAt("staffing_spike", new Date("2026-07-01T00:00:00Z")),
    now,
  };

  // HIGHER raw confidence, but detected months ago and already past its window.
  const stale: ScoreInput = {
    confidence: 0.9,
    detectedAt: new Date("2026-04-01T00:00:00Z"),
    expiresAt: computeExpiresAt("staffing_spike", new Date("2026-04-01T00:00:00Z")),
    now,
  };

  it("scores the expired signal at 0 regardless of confidence", () => {
    expect(decayedScore(stale)).toBe(0);
    expect(decayedScore(fresh)).toBeGreaterThan(0);
  });

  it("ranks the fresh signal above the higher-confidence stale one", () => {
    const ranked = [stale, fresh].sort(compareByScore);
    expect(ranked[0]).toBe(fresh);
    expect(ranked[1]).toBe(stale);
  });
});
