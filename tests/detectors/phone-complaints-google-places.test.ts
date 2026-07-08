import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizePlaceReviewsToCandidate,
  googlePlaceDetailsResponseSchema,
  type GooglePlaceDetailsResponse,
  type PhoneComplaintsQuery,
} from "@/src/detectors/phone-complaints-google-places";
import fixture from "./fixtures/google-places-details-response.json";

const NOW = new Date("2026-07-02T00:00:00Z");
const QUERY: PhoneComplaintsQuery = {
  practiceHint: "Sunshine Dermatology",
  placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
};

describe("normalizePlaceReviewsToCandidate", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("normalizes flagged reviews into a SignalCandidate citing the place's Google URL", () => {
    const parsed = googlePlaceDetailsResponseSchema.parse(fixture);
    const candidate = normalizePlaceReviewsToCandidate(parsed, QUERY, NOW);

    expect(candidate).not.toBeNull();
    expect(candidate?.kind).toBe("phone_complaints");
    expect(candidate?.practiceHint).toBe("Sunshine Dermatology");
    // Fixture has 4 reviews: Jane + Priya flag, Marcus + Devon don't -> 2 atoms.
    expect(candidate?.evidence).toHaveLength(2);
    expect(candidate?.confidence).toBeGreaterThan(0);
    expect(candidate?.confidence).toBeLessThanOrEqual(1);
    for (const atom of candidate?.evidence ?? []) {
      expect(atom.sourceUrl).toBe("https://maps.google.com/?cid=1234567890");
    }
  });

  it("never stores the raw review text as a snippet on the Google path (ToS guard)", () => {
    const parsed = googlePlaceDetailsResponseSchema.parse(fixture);
    const candidate = normalizePlaceReviewsToCandidate(parsed, QUERY, NOW);

    for (const atom of candidate?.evidence ?? []) {
      expect(atom.snippet).toBeUndefined();
      expect(atom.claim).toContain(QUERY.placeId);
      expect(atom.claim).not.toContain("can't get through");
      expect(atom.claim).not.toContain("Left on hold");
    }
  });

  it("returns null when the place lookup status is not OK", () => {
    const response: GooglePlaceDetailsResponse = { status: "NOT_FOUND" };
    const candidate = normalizePlaceReviewsToCandidate(response, QUERY, NOW);
    expect(candidate).toBeNull();
  });

  it("returns null when no review flags as a phone complaint", () => {
    const response: GooglePlaceDetailsResponse = {
      status: "OK",
      result: {
        place_id: QUERY.placeId,
        reviews: [{ text: "Lovely staff, quick visit." }],
      },
    };
    const candidate = normalizePlaceReviewsToCandidate(response, QUERY, NOW);
    expect(candidate).toBeNull();
  });

  it("falls back to a constructed Maps URL when the place has none", () => {
    const response: GooglePlaceDetailsResponse = {
      status: "OK",
      result: {
        place_id: QUERY.placeId,
        reviews: [{ text: "Can't get through no matter what I do." }],
      },
    };
    const candidate = normalizePlaceReviewsToCandidate(response, QUERY, NOW);
    expect(candidate?.evidence[0].sourceUrl).toContain(QUERY.placeId);
  });

  it("attaches geoKey when the query supplies one", () => {
    const response: GooglePlaceDetailsResponse = {
      status: "OK",
      result: {
        place_id: QUERY.placeId,
        reviews: [{ text: "Can't get through, always on hold." }],
      },
    };
    const candidate = normalizePlaceReviewsToCandidate(
      response,
      { ...QUERY, geoKey: "tampa-fl" },
      NOW,
    );
    expect(candidate?.geoKey).toBe("tampa-fl");
  });

  it("warns when review yield is below the minimum-yield threshold", () => {
    const response: GooglePlaceDetailsResponse = {
      status: "OK",
      result: {
        place_id: QUERY.placeId,
        reviews: [{ text: "Can't get through, always on hold." }],
      },
    };
    normalizePlaceReviewsToCandidate(response, QUERY, NOW);
    expect(warnSpy).toHaveBeenCalledWith(
      "phone-complaints detector: Google Places yield below minimum threshold",
      expect.objectContaining({ placeId: QUERY.placeId, reviewCount: 1 }),
    );
  });
});

describe("googlePlaceDetailsResponseSchema", () => {
  it("accepts a well-formed response", () => {
    const result = googlePlaceDetailsResponseSchema.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it("rejects a response missing status", () => {
    const result = googlePlaceDetailsResponseSchema.safeParse({ unexpected: "shape" });
    expect(result.success).toBe(false);
  });

  it("rejects a result with an invalid url", () => {
    const result = googlePlaceDetailsResponseSchema.safeParse({
      status: "OK",
      result: { place_id: "abc", url: "not-a-url" },
    });
    expect(result.success).toBe(false);
  });
});
