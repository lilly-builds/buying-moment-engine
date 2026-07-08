import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPhoneComplaintsDetector,
  phoneComplaintsDetector,
} from "@/src/detectors/phone-complaints";
import { candidateToRawSignals } from "@/src/engine/detector";
import { createMeter, type CostEventRecord } from "@/src/roi/cost-meter";
import type {
  FetchPlaceDetailsFn,
  PhoneComplaintsQuery,
} from "@/src/detectors/phone-complaints-google-places";
import fixture from "./fixtures/google-places-details-response.json";

const NOW = new Date("2026-07-02T00:00:00Z");
const QUERY: PhoneComplaintsQuery = {
  practiceHint: "Sunshine Dermatology",
  placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
  geoKey: "tampa-fl",
};

describe("phoneComplaintsDetector (exported const)", () => {
  it("has the phone_complaints kind and a stable, provider-tagged name", () => {
    expect(phoneComplaintsDetector.kind).toBe("phone_complaints");
    expect(phoneComplaintsDetector.name).toBe("phone-complaints:google-places");
  });

  it("ships with an empty default query list — the orchestrator wires in the real per-practice place-id list", async () => {
    const candidates = await phoneComplaintsDetector.detect({ now: NOW });
    expect(candidates).toEqual([]);
  });
});

describe("createPhoneComplaintsDetector", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("yields a SignalCandidate from a recorded fixture, citing the place's Google URL", async () => {
    const fetchPlaceDetails: FetchPlaceDetailsFn = async () => fixture;
    const detector = createPhoneComplaintsDetector(fetchPlaceDetails, [QUERY]);

    const candidates = await detector.detect({ now: NOW });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].kind).toBe("phone_complaints");
    expect(candidates[0].practiceHint).toBe("Sunshine Dermatology");
    expect(candidates[0].confidence).toBeGreaterThan(0);
    expect(candidates[0].confidence).toBeLessThanOrEqual(1);
    expect(candidates[0].evidence.length).toBeGreaterThanOrEqual(1);
    for (const atom of candidates[0].evidence) {
      expect(atom.sourceUrl).toBe("https://maps.google.com/?cid=1234567890");
    }
    // Fixture has 4 reviews (>= the minimum-yield threshold) and a well-formed
    // response, so nothing should warn.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("precision guard: flags an acute phone complaint but not a review that merely mentions the phone positively", async () => {
    const fetchPlaceDetails: FetchPlaceDetailsFn = async () => ({
      status: "OK",
      result: {
        place_id: "place-xyz",
        url: "https://maps.google.com/?cid=999",
        reviews: [
          { text: "Can't get through, always on hold whenever I call." },
          { text: "I called and the staff were lovely." },
          { text: "Great experience, in and out quickly." },
        ],
      },
    });
    const detector = createPhoneComplaintsDetector(fetchPlaceDetails, [
      { practiceHint: "Acme Family Practice", placeId: "place-xyz" },
    ]);

    const candidates = await detector.detect({ now: NOW });

    expect(candidates).toHaveLength(1);
    // Only the one acute complaint flags — the two positive reviews don't.
    expect(candidates[0].evidence).toHaveLength(1);
  });

  it("never persists the raw review text on the Google path — the emitted/flattened atom respects the no-store rule", async () => {
    const fetchPlaceDetails: FetchPlaceDetailsFn = async () => fixture;
    const detector = createPhoneComplaintsDetector(fetchPlaceDetails, [QUERY]);

    const candidates = await detector.detect({ now: NOW });
    for (const atom of candidates[0].evidence) {
      expect(atom.snippet).toBeUndefined();
      expect(atom.claim).toContain(QUERY.placeId);
    }

    // Flatten through the same framework path the runner uses, and confirm
    // the persisted payload never carries a `snippet` key either.
    for (const raw of candidateToRawSignals(candidates[0])) {
      expect(raw.payload).not.toHaveProperty("snippet");
    }
  });

  it("returns an empty result and logs when the fetcher throws (upstream failure)", async () => {
    const fetchPlaceDetails: FetchPlaceDetailsFn = async () => {
      throw new Error("upstream 503");
    };
    const detector = createPhoneComplaintsDetector(fetchPlaceDetails, [QUERY]);

    const candidates = await detector.detect({ now: NOW });

    expect(candidates).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      "phone-complaints detector: fetch failed",
      expect.objectContaining({ error: "upstream 503" }),
    );
  });

  it("returns an empty result and logs when the response is malformed (never partial garbage)", async () => {
    const fetchPlaceDetails: FetchPlaceDetailsFn = async () => ({ unexpected: "shape" });
    const detector = createPhoneComplaintsDetector(fetchPlaceDetails, [QUERY]);

    const candidates = await detector.detect({ now: NOW });

    expect(candidates).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      "phone-complaints detector: malformed place-details response",
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
    const fetchPlaceDetails: FetchPlaceDetailsFn = vi.fn(async () => fixture);
    const detector = createPhoneComplaintsDetector(fetchPlaceDetails, [QUERY], {
      source: "google-places",
    });

    await detector.detect({ now: NOW, meter });

    expect(fetchPlaceDetails).toHaveBeenCalledTimes(1);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      provider: "google-places",
      operation: "place-details+reviews",
      pipelineStep: "detect",
      units: 1,
      unitCostUsd: 0.005,
      costUsd: 0.005,
    });
  });

  it("does not fabricate a cost when no meter is present", async () => {
    const fetchPlaceDetails: FetchPlaceDetailsFn = vi.fn(async () => fixture);
    const detector = createPhoneComplaintsDetector(fetchPlaceDetails, [QUERY]);

    const candidates = await detector.detect({ now: NOW });

    expect(fetchPlaceDetails).toHaveBeenCalledTimes(1);
    expect(candidates.length).toBeGreaterThan(0);
  });
});
