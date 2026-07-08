import { describe, expect, it } from "vitest";
import {
  normalizeJobToCandidate,
  adzunaSearchResponseSchema,
  type AdzunaJobResult,
} from "@/src/detectors/staffing-spike-adzuna";

const NOW = new Date("2026-07-02T00:00:00Z");

function job(overrides: Partial<AdzunaJobResult> = {}): AdzunaJobResult {
  return {
    title: "Patient Coordinator - Front Desk",
    company: { display_name: "Sunshine Dermatology" },
    redirect_url: "https://www.adzuna.com/details/1001",
    ...overrides,
  };
}

describe("normalizeJobToCandidate", () => {
  it("normalizes a front-desk job into a SignalCandidate citing the job's own URL", () => {
    const candidate = normalizeJobToCandidate(job(), NOW);
    expect(candidate).not.toBeNull();
    expect(candidate?.kind).toBe("staffing_spike");
    expect(candidate?.practiceHint).toBe("Sunshine Dermatology");
    expect(candidate?.evidence[0].sourceUrl).toBe("https://www.adzuna.com/details/1001");
    expect(candidate?.confidence).toBeGreaterThan(0);
  });

  it("returns null for a clinical role (precision guard)", () => {
    const candidate = normalizeJobToCandidate(
      job({ title: "Registered Nurse - Outpatient" }),
      NOW,
    );
    expect(candidate).toBeNull();
  });

  it("returns null when the job has no attributable employer name", () => {
    const candidate = normalizeJobToCandidate(job({ company: undefined }), NOW);
    expect(candidate).toBeNull();
  });

  it("falls back to the injected clock when `created` is absent or unparseable", () => {
    const noCreated = normalizeJobToCandidate(job({ created: undefined }), NOW);
    expect(noCreated?.detectedAt).toEqual(NOW);

    const badCreated = normalizeJobToCandidate(job({ created: "not-a-date" }), NOW);
    expect(badCreated?.detectedAt).toEqual(NOW);
  });

  it("slugifies the location into a geoKey", () => {
    const candidate = normalizeJobToCandidate(
      job({ location: { display_name: "Tampa, FL" } }),
      NOW,
    );
    expect(candidate?.geoKey).toBe("tampa-fl");
  });

  it("omits geoKey when no location is present", () => {
    const candidate = normalizeJobToCandidate(job({ location: undefined }), NOW);
    expect(candidate?.geoKey).toBeUndefined();
  });
});

describe("adzunaSearchResponseSchema", () => {
  it("accepts a well-formed response", () => {
    const result = adzunaSearchResponseSchema.safeParse({
      results: [job()],
      count: 1,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a response missing the results array", () => {
    const result = adzunaSearchResponseSchema.safeParse({ unexpected: "shape" });
    expect(result.success).toBe(false);
  });

  it("rejects a job entry with an invalid source URL", () => {
    const result = adzunaSearchResponseSchema.safeParse({
      results: [{ title: "Front Desk", redirect_url: "not-a-url" }],
    });
    expect(result.success).toBe(false);
  });
});
