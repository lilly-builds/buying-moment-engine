import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchPlacesTextSearch,
  metroToGeoKey,
  normalizeTextSearchResponse,
  passesRatingFunnel,
  textSearchQueryString,
  textSearchResponseSchema,
  type PlaceCandidate,
  type TextSearchQuery,
  type TextSearchResponse,
} from "@/src/discovery/places-search";
import fixture from "./fixtures/google-places-textsearch-response.json";

const QUERY: TextSearchQuery = {
  category: "dermatology",
  metro: "Austin, TX",
  geoKey: "austin-tx",
};

describe("normalizeTextSearchResponse", () => {
  it("turns 3 fixture places into 3 PlaceCandidates with rating + review count from the SAME response (R1)", () => {
    const parsed = textSearchResponseSchema.parse(fixture);
    const candidates = normalizeTextSearchResponse(parsed, QUERY);

    expect(candidates).toHaveLength(3);
    expect(candidates.map((c) => c.placeId)).toEqual([
      "ChIJrundberg_derm",
      "ChIJbright_skin",
      "ChIJhill_country_skin",
    ]);
    // R1: no separate Details call needed to get rating / review count — Text Search
    // carries both in the enumeration response.
    expect(candidates[0]).toMatchObject({
      practiceHint: "Rundberg Dermatology",
      geoKey: "austin-tx",
      rating: 2.8,
      reviewCount: 176,
      address: "1200 Rundberg Ln, Austin, TX 78753, USA",
    });
  });

  it("treats a place with no `rating` field as unrated (null), never 0 — the funnel must not confuse them", () => {
    const parsed = textSearchResponseSchema.parse(fixture);
    const candidates = normalizeTextSearchResponse(parsed, QUERY);
    const unrated = candidates.find((c) => c.placeId === "ChIJhill_country_skin");
    expect(unrated?.rating).toBeNull();
    expect(unrated?.reviewCount).toBe(2);
  });

  it("returns [] for a non-OK status (ZERO_RESULTS)", () => {
    const response: TextSearchResponse = { status: "ZERO_RESULTS", results: [] };
    expect(normalizeTextSearchResponse(response, QUERY)).toEqual([]);
  });

  it("skips a result missing place_id or name instead of throwing", () => {
    const response: TextSearchResponse = {
      status: "OK",
      results: [
        { name: "No Place Id Clinic", rating: 2.1 },
        { place_id: "ChIJnoname", rating: 2.0 },
        { place_id: "ChIJgood", name: "Good Clinic", rating: 2.5 },
      ],
    };
    const candidates = normalizeTextSearchResponse(response, QUERY);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].placeId).toBe("ChIJgood");
  });
});

describe("passesRatingFunnel", () => {
  const low: PlaceCandidate = {
    placeId: "a",
    practiceHint: "Low",
    geoKey: "austin-tx",
    rating: 2.8,
    reviewCount: 100,
  };
  const high: PlaceCandidate = { ...low, placeId: "b", practiceHint: "High", rating: 4.9 };
  const unrated: PlaceCandidate = { ...low, placeId: "c", practiceHint: "Unrated", rating: null };

  it("passes a place rated BELOW the threshold", () => {
    expect(passesRatingFunnel(low, 4.0)).toBe(true);
  });

  it("drops a place rated AT OR ABOVE the threshold", () => {
    expect(passesRatingFunnel(high, 4.0)).toBe(false);
    expect(passesRatingFunnel({ ...low, rating: 4.0 }, 4.0)).toBe(false);
  });

  it("passes an UNRATED place — unknown is not a reason to silently drop it", () => {
    expect(passesRatingFunnel(unrated, 4.0)).toBe(true);
  });
});

describe("textSearchQueryString + metroToGeoKey", () => {
  it("builds a natural-language Google query from category + metro", () => {
    expect(textSearchQueryString(QUERY)).toBe("dermatology in Austin, TX");
  });

  it("derives a stable resolver geo key from a human metro string", () => {
    expect(metroToGeoKey("Austin, TX")).toBe("austin-tx");
    expect(metroToGeoKey("  Tampa,  FL ")).toBe("tampa-fl");
    expect(metroToGeoKey("Charlotte, NC")).toBe("charlotte-nc");
  });
});

describe("fetchPlacesTextSearch — the URL it builds (captured fetcher)", () => {
  const OLD_ENV = process.env.GOOGLE_PLACES_API_KEY;

  afterEach(() => {
    vi.restoreAllMocks();
    if (OLD_ENV === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = OLD_ENV;
  });

  it("puts the category+metro query and the key on the textsearch endpoint", async () => {
    process.env.GOOGLE_PLACES_API_KEY = "test-key-123";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] }), {
          status: 200,
        }),
      );

    await fetchPlacesTextSearch(QUERY);

    const url = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(url.pathname).toContain("/place/textsearch/json");
    expect(url.searchParams.get("query")).toBe("dermatology in Austin, TX");
    expect(url.searchParams.get("key")).toBe("test-key-123");
  });

  it("throws (an UNBILLED error) when the API key is absent", async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    await expect(fetchPlacesTextSearch(QUERY)).rejects.toThrow(/GOOGLE_PLACES_API_KEY/);
  });
});

describe("textSearchResponseSchema", () => {
  it("accepts the well-formed fixture", () => {
    expect(textSearchResponseSchema.safeParse(fixture).success).toBe(true);
  });

  it("defaults a missing results array to []", () => {
    const parsed = textSearchResponseSchema.parse({ status: "ZERO_RESULTS" });
    expect(parsed.results).toEqual([]);
  });

  it("rejects a response with no status", () => {
    expect(textSearchResponseSchema.safeParse({ results: [] }).success).toBe(false);
  });
});
