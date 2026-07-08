import { describe, expect, it } from "vitest";
import {
  normalizeArticleToCandidate,
  gdeltSearchResponseSchema,
  type GdeltArticle,
} from "@/src/detectors/growth-events-gdelt";

const NOW = new Date("2026-07-02T00:00:00Z");

function article(overrides: Partial<GdeltArticle> = {}): GdeltArticle {
  return {
    url: "https://healthbizjournal.example.com/2026/06/28/riverside-partners-acquires-sunshine-family-dental",
    title: "Riverside Partners Acquires Sunshine Family Dental in Regional Expansion Deal",
    ...overrides,
  };
}

describe("normalizeArticleToCandidate", () => {
  it("normalizes a growth-event article into a SignalCandidate citing the article's own URL", () => {
    const candidate = normalizeArticleToCandidate(article(), NOW);
    expect(candidate).not.toBeNull();
    expect(candidate?.kind).toBe("growth_events");
    expect(candidate?.practiceHint).toBe("Sunshine Family Dental");
    expect(candidate?.evidence[0].sourceUrl).toBe(article().url);
    expect(candidate?.confidence).toBeGreaterThan(0);
  });

  it("returns null for an irrelevant article (precision guard)", () => {
    const candidate = normalizeArticleToCandidate(
      article({ title: "New Study Finds Link Between Diet and Heart Disease Risk" }),
      NOW,
    );
    expect(candidate).toBeNull();
  });

  it("returns null when a growth-event phrase has no attributable practice name", () => {
    const candidate = normalizeArticleToCandidate(
      article({
        title: "Private Equity Investment in Healthcare Services Grew 12% Last Year",
      }),
      NOW,
    );
    expect(candidate).toBeNull();
  });

  it("parses GDELT's compact seendate into detectedAt", () => {
    const candidate = normalizeArticleToCandidate(
      article({ seendate: "20260628T140000Z" }),
      NOW,
    );
    expect(candidate?.detectedAt).toEqual(new Date("2026-06-28T14:00:00Z"));
  });

  it("falls back to the injected clock when seendate is absent or unparseable", () => {
    const noSeendate = normalizeArticleToCandidate(article({ seendate: undefined }), NOW);
    expect(noSeendate?.detectedAt).toEqual(NOW);

    const badSeendate = normalizeArticleToCandidate(article({ seendate: "not-a-date" }), NOW);
    expect(badSeendate?.detectedAt).toEqual(NOW);
  });

  it("slugifies sourcecountry into a geoKey", () => {
    const candidate = normalizeArticleToCandidate(
      article({ sourcecountry: "United States" }),
      NOW,
    );
    expect(candidate?.geoKey).toBe("united-states");
  });

  it("omits geoKey when no sourcecountry is present", () => {
    const candidate = normalizeArticleToCandidate(article({ sourcecountry: undefined }), NOW);
    expect(candidate?.geoKey).toBeUndefined();
  });
});

describe("gdeltSearchResponseSchema", () => {
  it("accepts a well-formed response", () => {
    const result = gdeltSearchResponseSchema.safeParse({ articles: [article()] });
    expect(result.success).toBe(true);
  });

  it("rejects a response missing the articles array", () => {
    const result = gdeltSearchResponseSchema.safeParse({ unexpected: "shape" });
    expect(result.success).toBe(false);
  });

  it("rejects an article entry with an invalid url", () => {
    const result = gdeltSearchResponseSchema.safeParse({
      articles: [{ url: "not-a-url", title: "Some Title" }],
    });
    expect(result.success).toBe(false);
  });
});
