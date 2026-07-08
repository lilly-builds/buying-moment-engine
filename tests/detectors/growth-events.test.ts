import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGrowthEventsDetector,
  growthEventsDetector,
} from "@/src/detectors/growth-events";
import { createMeter, type CostEventRecord } from "@/src/roi/cost-meter";
import type { FetchArticlesFn } from "@/src/detectors/growth-events-gdelt";
import fixture from "./fixtures/gdelt-search-response.json";

const NOW = new Date("2026-07-02T00:00:00Z");

describe("growthEventsDetector (exported const)", () => {
  it("has the growth_events kind and a stable, provider-tagged name", () => {
    expect(growthEventsDetector.kind).toBe("growth_events");
    expect(growthEventsDetector.name).toBe("growth-events:gdelt");
  });
});

describe("createGrowthEventsDetector", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("yields a SignalCandidate per growth-event article, citing the article's own URL, and skips the irrelevant one", async () => {
    const fetchArticles: FetchArticlesFn = async () => fixture;
    const detector = createGrowthEventsDetector(fetchArticles);

    const candidates = await detector.detect({ now: NOW });

    // Fixture has 3 articles: 1 acquisition (naming a practice), 1 expansion
    // (naming a practice), 1 general-health article (irrelevant) -> 2 candidates.
    expect(candidates).toHaveLength(2);

    const sunshine = candidates.find((c) => c.practiceHint === "Sunshine Family Dental");
    expect(sunshine).toBeDefined();
    expect(sunshine?.kind).toBe("growth_events");
    expect(sunshine?.confidence).toBeGreaterThan(0);
    expect(sunshine?.confidence).toBeLessThanOrEqual(1);
    expect(sunshine?.evidence).toHaveLength(1);
    expect(sunshine?.evidence[0].sourceUrl).toBe(
      "https://healthbizjournal.example.com/2026/06/28/riverside-partners-acquires-sunshine-family-dental",
    );
    expect(sunshine?.geoKey).toBe("united-states");
    expect(sunshine?.detectedAt).toEqual(new Date("2026-06-28T14:00:00Z"));

    const meadowbrook = candidates.find((c) => c.practiceHint === "Meadowbrook Animal Hospital");
    expect(meadowbrook).toBeDefined();
    expect(meadowbrook?.evidence[0].sourceUrl).toBe(
      "https://vetindustrynews.example.com/2026/06/29/meadowbrook-animal-hospital-opens-second-location",
    );

    // The general-health article never produces a candidate at all (precision guard, R7).
    expect(
      candidates.some((c) => c.evidence[0].sourceUrl.includes("diet-heart-disease-study")),
    ).toBe(false);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("fires for a growth-event-only response", async () => {
    const fetchArticles: FetchArticlesFn = async () => ({
      articles: [
        {
          url: "https://newswire.example.com/acme-family-practice-acquired",
          title: "Acme Family Practice Acquired by Regional Health Group",
        },
      ],
    });
    const detector = createGrowthEventsDetector(fetchArticles);

    const candidates = await detector.detect({ now: NOW });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].kind).toBe("growth_events");
    expect(candidates[0].practiceHint).toBe("Acme Family Practice");
  });

  it("returns an empty result and logs when the fetcher throws (upstream failure)", async () => {
    const fetchArticles: FetchArticlesFn = async () => {
      throw new Error("upstream 503");
    };
    const detector = createGrowthEventsDetector(fetchArticles);

    const candidates = await detector.detect({ now: NOW });

    expect(candidates).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      "growth-events detector: fetch failed",
      expect.objectContaining({ error: "upstream 503" }),
    );
  });

  it("returns an empty result and logs when the response is malformed (never partial garbage)", async () => {
    const fetchArticles: FetchArticlesFn = async () => ({ unexpected: "shape" });
    const detector = createGrowthEventsDetector(fetchArticles);

    const candidates = await detector.detect({ now: NOW });

    expect(candidates).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      "growth-events detector: malformed news response",
      expect.objectContaining({ issues: expect.any(Array) }),
    );
  });

  it("meters each fetch (R19), even at $0 for the free GDELT tier", async () => {
    const recorded: CostEventRecord[] = [];
    const meter = createMeter({
      record: async (row) => {
        recorded.push(row);
      },
    });
    const fetchArticles: FetchArticlesFn = vi.fn(async () => fixture);
    const detector = createGrowthEventsDetector(fetchArticles, { source: "gdelt" });

    await detector.detect({ now: NOW, meter });

    expect(fetchArticles).toHaveBeenCalledTimes(1);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      provider: "gdelt",
      operation: "news.search",
      pipelineStep: "detect",
      units: 1,
      unitCostUsd: 0,
      costUsd: 0,
    });
  });

  it("does not fabricate a cost when no meter is present (no live fetch metered vs none)", async () => {
    const fetchArticles: FetchArticlesFn = vi.fn(async () => fixture);
    const detector = createGrowthEventsDetector(fetchArticles);

    const candidates = await detector.detect({ now: NOW });

    expect(fetchArticles).toHaveBeenCalledTimes(1);
    expect(candidates.length).toBeGreaterThan(0);
  });
});
