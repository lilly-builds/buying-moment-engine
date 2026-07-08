import { describe, expect, it } from "vitest";
import {
  candidateDedupeHash,
  candidateToRawSignals,
  type SignalCandidate,
} from "@/src/engine/detector";

describe("candidateDedupeHash", () => {
  it("is deterministic for the same kind|sourceUrl|practiceHint", () => {
    const a = candidateDedupeHash(
      "staffing_spike",
      "https://boards.example.com/job/1",
      "Sunshine Dermatology",
    );
    const b = candidateDedupeHash(
      "staffing_spike",
      "https://boards.example.com/job/1",
      "Sunshine Dermatology",
    );
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("normalizes the practice hint so casing/whitespace de-dupe together", () => {
    const canonical = candidateDedupeHash(
      "staffing_spike",
      "https://x.example.com",
      "Sunshine Dermatology",
    );
    const noisy = candidateDedupeHash(
      "staffing_spike",
      "https://x.example.com",
      "  SUNSHINE   dermatology ",
    );
    expect(noisy).toBe(canonical);
  });

  it("differs when the source URL differs", () => {
    const one = candidateDedupeHash("staffing_spike", "https://a", "Acme Derm");
    const two = candidateDedupeHash("staffing_spike", "https://b", "Acme Derm");
    expect(one).not.toBe(two);
  });
});

describe("candidateToRawSignals", () => {
  const candidate: SignalCandidate = {
    practiceHint: "Sunshine Dermatology",
    kind: "staffing_spike",
    confidence: 0.7,
    detectedAt: new Date("2026-07-01T00:00:00Z"),
    geoKey: "tampa-fl",
    evidence: [
      {
        claim: "Hiring 3 front-desk coordinators",
        sourceUrl: "https://boards.example.com/job/1",
        snippet: "3 openings posted",
        confidence: 0.9,
      },
      {
        claim: "Posting for a practice manager",
        sourceUrl: "https://boards.example.com/job/2",
      },
    ],
  };

  it("emits one raw signal per evidence atom, carrying its own citation", () => {
    const raws = candidateToRawSignals(candidate);
    expect(raws).toHaveLength(2);
    expect(raws[0].sourceUrl).toBe("https://boards.example.com/job/1");
    expect(raws[1].sourceUrl).toBe("https://boards.example.com/job/2");
    for (const raw of raws) {
      expect(raw.detectorKind).toBe("staffing_spike");
      expect(raw.practiceHint).toBe("Sunshine Dermatology");
      expect(raw.geoKey).toBe("tampa-fl");
      expect(raw.detectedAt).toEqual(new Date("2026-07-01T00:00:00Z"));
      expect(raw.dedupeHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("puts claim + snippet + confidence in the payload", () => {
    const [first, second] = candidateToRawSignals(candidate);
    expect(first.payload.claim).toBe("Hiring 3 front-desk coordinators");
    expect(first.payload.snippet).toBe("3 openings posted");
    // Evidence-level confidence wins when present...
    expect(first.payload.confidence).toBe(0.9);
    // ...and falls back to the candidate confidence when absent.
    expect(second.payload.confidence).toBe(0.7);
    expect(second.payload.snippet).toBeUndefined();
  });

  it("gives distinct evidence URLs distinct dedupe hashes", () => {
    const [first, second] = candidateToRawSignals(candidate);
    expect(first.dedupeHash).not.toBe(second.dedupeHash);
  });

  it("returns no raw signals for a candidate with no evidence", () => {
    expect(candidateToRawSignals({ ...candidate, evidence: [] })).toEqual([]);
  });
});
