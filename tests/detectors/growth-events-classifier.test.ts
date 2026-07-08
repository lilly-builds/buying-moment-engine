import { describe, expect, it } from "vitest";
import {
  classifyGrowthEvent,
  extractPracticeName,
} from "@/src/detectors/growth-events-classifier";

describe("extractPracticeName", () => {
  it("extracts a practice name preceding a single-word suffix, ignoring an acquirer's name and verb", () => {
    const name = extractPracticeName(
      "Riverside Partners Acquires Sunshine Family Dental in Regional Expansion Deal",
    );
    expect(name).toBe("Sunshine Family Dental");
  });

  it("extracts a practice name preceding a compound suffix", () => {
    const name = extractPracticeName(
      "Meadowbrook Animal Hospital Opens Second Location After Growth Capital Raise",
    );
    expect(name).toBe("Meadowbrook Animal Hospital");
  });

  it("returns undefined when no recognized practice-type noun is present", () => {
    const name = extractPracticeName("New Study Finds Link Between Diet and Heart Disease Risk");
    expect(name).toBeUndefined();
  });

  it("returns undefined when the suffix isn't preceded by an attributable capitalized word", () => {
    const name = extractPracticeName("Announces Expansion of the Dental Industry Nationwide");
    expect(name).toBeUndefined();
  });

  it("handles various single-word practice-type suffixes", () => {
    expect(extractPracticeName("Bright Smiles Orthodontics Announces Expansion")).toBe(
      "Bright Smiles Orthodontics",
    );
    expect(extractPracticeName("City Urgent Care Opens New Location Downtown")).toBe(
      "City Urgent Care",
    );
  });
});

describe("classifyGrowthEvent", () => {
  it("fires for a PE-deal article naming a practice, extracting the practice name", () => {
    const result = classifyGrowthEvent(
      "Riverside Partners Acquires Sunshine Family Dental in Regional Expansion Deal",
    );
    expect(result.isGrowthEvent).toBe(true);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.practiceHint).toBe("Sunshine Family Dental");
    expect(result.matchedPhrase).toBe("acquires");
  });

  it("fires for an expansion/new-location announcement naming a practice", () => {
    const result = classifyGrowthEvent(
      "Meadowbrook Animal Hospital Opens Second Location After Growth Capital Raise",
    );
    expect(result.isGrowthEvent).toBe(true);
    expect(result.practiceHint).toBe("Meadowbrook Animal Hospital");
    expect(result.matchedPhrase).toBe("opens second location");
  });

  it("does NOT fire for an irrelevant general-health article (precision guard)", () => {
    const result = classifyGrowthEvent("New Study Finds Link Between Diet and Heart Disease Risk");
    expect(result.isGrowthEvent).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.practiceHint).toBeUndefined();
  });

  it("does NOT fire for a growth-event phrase with no attributable practice name", () => {
    // Industry-wide PE roundup — no specific practice named.
    const result = classifyGrowthEvent(
      "Private Equity Investment in Healthcare Services Grew 12% Last Year",
    );
    expect(result.isGrowthEvent).toBe(false);
    expect(result.confidence).toBe(0);
  });

  it("does NOT fire for a named practice with no growth-event language", () => {
    const result = classifyGrowthEvent("Sunshine Family Dental Hosts Community Health Fair");
    expect(result.isGrowthEvent).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.practiceHint).toBeUndefined();
  });

  it("is case-insensitive on the growth-event phrase", () => {
    const result = classifyGrowthEvent(
      "Riverside Partners ACQUIRES Sunshine Family Dental in Regional Expansion",
    );
    expect(result.isGrowthEvent).toBe(true);
  });

  it("picks the highest-confidence phrase when multiple match", () => {
    const result = classifyGrowthEvent(
      "Meadowbrook Animal Hospital Opens Second Location After Growth Capital Raise",
    );
    // "opens second location" (0.78) outranks "growth capital" (0.68).
    expect(result.matchedPhrase).toBe("opens second location");
  });
});
