import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createStaffingSpikeDetector,
  staffingSpikeDetector,
} from "@/src/detectors/staffing-spike";
import { createMeter, type CostEventRecord } from "@/src/roi/cost-meter";
import type { FetchJobsFn } from "@/src/detectors/staffing-spike-adzuna";
import fixture from "./fixtures/adzuna-search-response.json";

const NOW = new Date("2026-07-02T00:00:00Z");

describe("staffingSpikeDetector (exported const)", () => {
  it("has the staffing_spike kind and a stable, provider-tagged name", () => {
    expect(staffingSpikeDetector.kind).toBe("staffing_spike");
    expect(staffingSpikeDetector.name).toBe("staffing-spike:adzuna");
  });
});

describe("createStaffingSpikeDetector", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("yields a SignalCandidate per front-desk job, citing the job post's source URL, and skips the clinical one", async () => {
    const fetchJobs: FetchJobsFn = async () => fixture;
    const detector = createStaffingSpikeDetector(fetchJobs);

    const candidates = await detector.detect({ now: NOW });

    // Fixture has 3 postings: 1 front-desk, 1 RN (clinical, excluded), 1 call
    // center rep (front-desk) -> exactly 2 candidates.
    expect(candidates).toHaveLength(2);

    const sunshine = candidates.find((c) => c.practiceHint === "Sunshine Dermatology");
    expect(sunshine).toBeDefined();
    expect(sunshine?.kind).toBe("staffing_spike");
    expect(sunshine?.confidence).toBeGreaterThan(0);
    expect(sunshine?.confidence).toBeLessThanOrEqual(1);
    expect(sunshine?.evidence).toHaveLength(1);
    expect(sunshine?.evidence[0].sourceUrl).toBe("https://www.adzuna.com/details/1001");
    expect(sunshine?.geoKey).toBe("tampa-fl");
    expect(sunshine?.detectedAt).toEqual(new Date("2026-06-30T08:00:00Z"));

    const metroVet = candidates.find((c) => c.practiceHint === "Metro Vet Group");
    expect(metroVet).toBeDefined();
    expect(metroVet?.evidence[0].sourceUrl).toBe("https://www.adzuna.com/details/1003");

    // The RN posting never produces a candidate at all (precision guard, R7).
    expect(candidates.some((c) => c.evidence[0].sourceUrl.includes("1002"))).toBe(false);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("fires for a front-desk-only response", async () => {
    const fetchJobs: FetchJobsFn = async () => ({
      results: [
        {
          title: "Front Desk Receptionist",
          company: { display_name: "Acme Family Practice" },
          redirect_url: "https://boards.example.com/job/42",
        },
      ],
    });
    const detector = createStaffingSpikeDetector(fetchJobs);

    const candidates = await detector.detect({ now: NOW });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].kind).toBe("staffing_spike");
    expect(candidates[0].practiceHint).toBe("Acme Family Practice");
  });

  it("returns an empty result and logs when the fetcher throws (upstream failure)", async () => {
    const fetchJobs: FetchJobsFn = async () => {
      throw new Error("upstream 503");
    };
    const detector = createStaffingSpikeDetector(fetchJobs);

    const candidates = await detector.detect({ now: NOW });

    expect(candidates).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      "staffing-spike detector: fetch failed",
      expect.objectContaining({ error: "upstream 503" }),
    );
  });

  it("returns an empty result and logs when the response is malformed (never partial garbage)", async () => {
    const fetchJobs: FetchJobsFn = async () => ({ unexpected: "shape" });
    const detector = createStaffingSpikeDetector(fetchJobs);

    const candidates = await detector.detect({ now: NOW });

    expect(candidates).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      "staffing-spike detector: malformed jobs response",
      expect.objectContaining({ issues: expect.any(Array) }),
    );
  });

  it("meters each paid fetch (R19)", async () => {
    const recorded: CostEventRecord[] = [];
    const meter = createMeter({
      record: async (row) => {
        recorded.push(row);
      },
    });
    const fetchJobs: FetchJobsFn = vi.fn(async () => fixture);
    const detector = createStaffingSpikeDetector(fetchJobs, { source: "adzuna" });

    await detector.detect({ now: NOW, meter });

    expect(fetchJobs).toHaveBeenCalledTimes(1);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      provider: "adzuna",
      operation: "jobs.search",
      pipelineStep: "detect",
      units: 1,
      unitCostUsd: 0,
      costUsd: 0,
    });
  });

  it("does not fabricate a cost when no meter is present (no live fetch metered vs none)", async () => {
    const fetchJobs: FetchJobsFn = vi.fn(async () => fixture);
    const detector = createStaffingSpikeDetector(fetchJobs);

    const candidates = await detector.detect({ now: NOW });

    expect(fetchJobs).toHaveBeenCalledTimes(1);
    expect(candidates.length).toBeGreaterThan(0);
  });
});
