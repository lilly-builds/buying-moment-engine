import { describe, expect, it } from "vitest";
import { resolvePracticeWebsite } from "@/src/enrich/website";
import { recordingMeter } from "./doubles";

const QUERY = { name: "Sanova Dermatology", city: "Austin", state: "TX" };

const searchOk = (name = "Sanova Dermatology", placeId = "p1") => ({
  status: "OK",
  results: [{ place_id: placeId, name, rating: 3.1, user_ratings_total: 40 }],
});
const detailsWithWebsite = (website: string, placeId = "p1") => ({
  status: "OK",
  result: { place_id: placeId, name: "Sanova Dermatology", website },
});

describe("resolvePracticeWebsite (Plan B)", () => {
  it("returns the homepage and meters BOTH Places calls (R19)", async () => {
    const { meter, rows } = recordingMeter();
    const website = await resolvePracticeWebsite(
      { meter, fetchTextSearch: async () => searchOk(), fetchPlaceWebsite: async () => detailsWithWebsite("https://sanovaderm.com") },
      QUERY,
    );
    expect(website).toBe("https://sanovaderm.com");
    expect(rows.map((r) => r.operation)).toEqual(["website.textsearch", "website.details"]);
    expect(rows.every((r) => r.provider === "google_places")).toBe(true);
    expect(rows.reduce((s, r) => s + r.costUsd, 0)).toBeGreaterThan(0);
  });

  it("returns null when Text Search finds nothing (no details call)", async () => {
    const { meter, rows } = recordingMeter();
    let websiteCalls = 0;
    const website = await resolvePracticeWebsite(
      {
        meter,
        fetchTextSearch: async () => ({ status: "ZERO_RESULTS", results: [] }),
        fetchPlaceWebsite: async () => {
          websiteCalls += 1;
          return detailsWithWebsite("https://nope.com");
        },
      },
      QUERY,
    );
    expect(website).toBeNull();
    expect(websiteCalls).toBe(0);
    expect(rows.map((r) => r.operation)).toEqual(["website.textsearch"]);
  });

  it("rejects an unrelated business (name-mismatch guard) without a details call", async () => {
    let websiteCalls = 0;
    const website = await resolvePracticeWebsite(
      {
        meter: recordingMeter().meter,
        fetchTextSearch: async () => searchOk("Austin Foot & Ankle Center", "p9"),
        fetchPlaceWebsite: async () => {
          websiteCalls += 1;
          return detailsWithWebsite("https://wrong-business.com", "p9");
        },
      },
      QUERY,
    );
    expect(website).toBeNull();
    expect(websiteCalls).toBe(0);
  });

  it("returns null when the matched place has no website", async () => {
    const website = await resolvePracticeWebsite(
      {
        meter: recordingMeter().meter,
        fetchTextSearch: async () => searchOk(),
        fetchPlaceWebsite: async () => ({ status: "OK", result: { place_id: "p1", name: "Sanova Dermatology" } }),
      },
      QUERY,
    );
    expect(website).toBeNull();
  });

  it("never throws — a thrown Places call returns null", async () => {
    const website = await resolvePracticeWebsite(
      {
        meter: recordingMeter().meter,
        fetchTextSearch: async () => {
          throw new Error("429 rate limited");
        },
      },
      QUERY,
    );
    expect(website).toBeNull();
  });
});
