import { describe, expect, it } from "vitest";
import {
  FRESHNESS_WINDOW_DAYS,
  computeExpiresAt,
  freshnessWeight,
  isFresh,
  windowDaysFor,
} from "@/src/engine/freshness";

const DETECTED = new Date("2026-07-01T00:00:00Z");

describe("freshness windows", () => {
  it("has a window for every detector kind", () => {
    expect(windowDaysFor("staffing_spike")).toBe(30);
    expect(windowDaysFor("growth_events")).toBe(60);
    expect(windowDaysFor("phone_complaints")).toBe(90);
    expect(windowDaysFor("regulation")).toBe(180);
    expect(Object.keys(FRESHNESS_WINDOW_DAYS)).toHaveLength(4);
  });

  it("computeExpiresAt offsets detectedAt by the kind's window", () => {
    expect(computeExpiresAt("staffing_spike", DETECTED)).toEqual(
      new Date("2026-07-31T00:00:00Z"),
    );
    expect(computeExpiresAt("regulation", DETECTED)).toEqual(
      new Date("2026-12-28T00:00:00Z"),
    );
  });
});

describe("isFresh", () => {
  const expires = computeExpiresAt("staffing_spike", DETECTED); // 2026-07-31

  it("is fresh before expiry and stale at/after it", () => {
    expect(isFresh(expires, new Date("2026-07-15T00:00:00Z"))).toBe(true);
    expect(isFresh(expires, new Date("2026-08-01T00:00:00Z"))).toBe(false);
    expect(isFresh(expires, expires)).toBe(false);
  });

  it("treats an unknown (null) window as fresh — never silently drop", () => {
    expect(isFresh(null, new Date("2030-01-01T00:00:00Z"))).toBe(true);
    expect(isFresh(undefined, DETECTED)).toBe(true);
  });
});

describe("freshnessWeight", () => {
  const expires = computeExpiresAt("staffing_spike", DETECTED); // +30d

  it("is 1.0 at detection, 0.0 at/after expiry, and linear between", () => {
    expect(freshnessWeight(DETECTED, expires, DETECTED)).toBe(1);
    expect(
      freshnessWeight(DETECTED, expires, new Date("2026-07-16T00:00:00Z")),
    ).toBeCloseTo(0.5, 10);
    expect(
      freshnessWeight(DETECTED, expires, new Date("2026-08-10T00:00:00Z")),
    ).toBe(0);
  });

  it("returns 1.0 when the window is null (no decay)", () => {
    expect(freshnessWeight(DETECTED, null, new Date("2030-01-01T00:00:00Z"))).toBe(
      1,
    );
  });
});
