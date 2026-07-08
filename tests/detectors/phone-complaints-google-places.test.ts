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

  it("aggregates flagged reviews into ONE SignalCandidate atom carrying the MAX confidence", () => {
    const parsed = googlePlaceDetailsResponseSchema.parse(fixture);
    const candidate = normalizePlaceReviewsToCandidate(parsed, QUERY, NOW);

    expect(candidate).not.toBeNull();
    expect(candidate?.kind).toBe("phone_complaints");
    expect(candidate?.practiceHint).toBe("Sunshine Dermatology");
    // Fixture: Jane (max phrase conf 0.9) + Priya (0.85) flag; Marcus + Devon
    // don't. All would share this place's single URL, so the framework's
    // sourceUrl dedupe collapses same-URL atoms at ingest — emit exactly ONE
    // aggregated atom that carries the MAX confidence, never N per-review atoms.
    expect(candidate?.evidence).toHaveLength(1);
    expect(candidate?.confidence).toBe(0.9);
    expect(candidate?.evidence[0].confidence).toBe(0.9);
    expect(candidate?.evidence[0].sourceUrl).toBe("https://maps.google.com/?cid=1234567890");
    // The claim summarizes the count + the distinct closed-vocabulary categories.
    expect(candidate?.evidence[0].claim).toContain("2 Google reviews");
    expect(candidate?.evidence[0].claim).toContain("cannot-get-through");
    expect(candidate?.evidence[0].claim).toContain("long-hold");
  });

  it("never stores the raw review text as a snippet on the Google path (ToS guard)", () => {
    const parsed = googlePlaceDetailsResponseSchema.parse(fixture);
    const candidate = normalizePlaceReviewsToCandidate(parsed, QUERY, NOW);

    expect(candidate?.evidence).toHaveLength(1);
    for (const atom of candidate?.evidence ?? []) {
      expect(atom.snippet).toBeUndefined();
      expect(atom.claim).toContain(QUERY.placeId);
      // The claim carries only place_id + closed-vocab categories + count —
      // never a word of any review's own text.
      expect(atom.claim).not.toContain("can't get through");
      expect(atom.claim).not.toContain("Left on hold");
      expect(atom.claim).not.toContain("nightmare");
      expect(atom.claim).not.toContain("20 minutes");
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
