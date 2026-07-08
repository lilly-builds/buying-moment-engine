import { describe, expect, it } from "vitest";
import {
  parseRecords,
  sizeBand,
  summarize,
  validateCohort,
  type ExperimentRecord,
} from "@/src/enrich/experiment-metrics";

/**
 * The harness's own guard rails. The cohort validator must fail BEFORE any paid
 * call, and the summary must never flatter a provider for a lookup we skipped.
 */

function entry(over: Partial<Record<string, unknown>> = {}) {
  return {
    key: "practice-1",
    name: "Sunshine Dermatology",
    city: "Miami",
    state: "FL",
    geoKey: "miami-fl",
    locationsCount: 1,
    verticalHint: "dermatology",
    ...over,
  };
}

/** 5 small + 5 mid/large across 2 verticals — the required stratification. */
function validCohort() {
  return [
    ...Array.from({ length: 5 }, (_, i) =>
      entry({ key: `small-${i}`, locationsCount: i % 2 === 0 ? 1 : 2 }),
    ),
    ...Array.from({ length: 5 }, (_, i) =>
      entry({
        key: `large-${i}`,
        locationsCount: 3 + i,
        verticalHint: "orthopedics",
      }),
    ),
  ];
}

describe("cohort stratification is enforced before a cent is spent", () => {
  it("accepts a 5 small + 5 mid/large cohort spanning two verticals", () => {
    const result = validateCohort(validCohort());
    expect(result.ok).toBe(true);
  });

  it("rejects a cohort that is not exactly 10", () => {
    const result = validateCohort(validCohort().slice(0, 9));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/exactly 10/);
  });

  it("rejects a cohort with too few SMALL practices (the named coverage risk)", () => {
    const cohort = validCohort().map((c) => ({ ...c, locationsCount: 6 }));
    const result = validateCohort(cohort);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/small practices/);
  });

  it("rejects a cohort with too few mid/large practices", () => {
    const cohort = validCohort().map((c) => ({ ...c, locationsCount: 1 }));
    const result = validateCohort(cohort);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/mid\/large/);
  });

  it("rejects a single-vertical cohort", () => {
    const cohort = validCohort().map((c) => ({
      ...c,
      verticalHint: "dermatology",
    }));
    const result = validateCohort(cohort);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/verticals/);
  });

  it("rejects duplicate keys — the resume key must be unique", () => {
    const cohort = validCohort();
    cohort[9] = { ...cohort[9], key: cohort[0].key };
    const result = validateCohort(cohort);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/unique/);
  });

  it("bands on the plan's boundary: 1-2 = small, 3+ = mid/large", () => {
    expect(sizeBand(1)).toBe("small");
    expect(sizeBand(2)).toBe("small");
    expect(sizeBand(3)).toBe("mid_large");
  });
});

function record(over: Partial<ExperimentRecord> = {}): ExperimentRecord {
  return {
    key: "k",
    name: "n",
    sizeBand: "small",
    verticalHint: "dermatology",
    ranAt: "2026-07-08T00:00:00Z",
    claude: {
      ok: true,
      company: { specialty: true, ehr: true, locationsCount: false, providerCount: false, website: true },
      person: { name: true, role: true, email: false, linkedinUrl: false },
      costUsd: 0.1,
      error: null,
    },
    pdlCompany: {
      attempted: true,
      matched: true,
      company: { specialty: true, ehr: false, locationsCount: true, providerCount: false, website: true },
      costUsd: 0.28,
      error: null,
    },
    pdlPerson: {
      attempted: true,
      skipReason: null,
      matched: true,
      person: { name: false, role: false, email: true, linkedinUrl: true },
      costUsd: 0.28,
      error: null,
    },
    ...over,
  };
}

describe("per-field summary — the split is per field, not per record", () => {
  it("computes a hit-rate per (provider, field) pair", () => {
    const summary = summarize([record(), record({ key: "k2" })]);

    expect(summary.records).toBe(2);
    expect(summary.claudeCompany.fields.ehr.rate).toBe(1);
    expect(summary.claudeCompany.fields.locationsCount.rate).toBe(0);
    expect(summary.claudePerson.fields.email.rate).toBe(0);

    // The finding the split hinges on: PDL has no EHR data at all.
    expect(summary.pdlCompany.fields.ehr.rate).toBe(0);
    expect(summary.pdlPerson.fields.email.rate).toBe(1);
    expect(summary.pdlPerson.fields.linkedinUrl.rate).toBe(1);
  });

  it("a skipped PDL person lookup is NOT counted against its hit-rate", () => {
    const skipped = record({
      key: "k2",
      pdlPerson: {
        attempted: false,
        skipReason: "no name",
        matched: false,
        person: {},
        costUsd: 0,
        error: null,
      },
    });
    const summary = summarize([record(), skipped]);

    // Denominator is 1 (only the attempted record), so the rate stays 1.0 — a
    // skipped lookup neither flatters nor penalises the provider.
    expect(summary.pdlPerson.fields.email).toEqual({
      hits: 1,
      attempts: 1,
      rate: 1,
    });
    expect(summary.pdlPerson.records).toBe(1);
  });

  it("a failed Claude call is excluded from Claude's denominator", () => {
    const failed = record({
      key: "k2",
      claude: {
        ok: false,
        company: {},
        person: {},
        costUsd: 0.05,
        error: "malformed JSON",
      },
    });
    const summary = summarize([record(), failed]);
    expect(summary.claudeCompany.records).toBe(1);
    expect(summary.claudeCompany.fields.specialty.attempts).toBe(1);
    // Cost of the failed call still counts — it was paid for.
    expect(summary.claudeCompany.totalCostUsd).toBeCloseTo(0.15, 10);
    expect(summary.claudeCompany.costPerRecordUsd).toBeCloseTo(0.075, 10);
  });

  it("does not double-count Claude's single call across the company/person halves", () => {
    const summary = summarize([record()]);
    expect(summary.claudePerson.totalCostUsd).toBe(0);
    expect(summary.totalCostUsd).toBeCloseTo(0.1 + 0.28 + 0.28, 10);
  });

  it("EDGE CASE: an empty result set summarizes to zeros, never NaN", () => {
    const summary = summarize([]);
    expect(summary.records).toBe(0);
    expect(summary.totalCostUsd).toBe(0);
    expect(summary.claudeCompany.costPerRecordUsd).toBe(0);
    expect(summary.claudeCompany.fields.specialty.rate).toBe(0);
  });
});

describe("append-only, resumable results file", () => {
  it("parses JSONL and skips blank lines", () => {
    const jsonl = `${JSON.stringify(record())}\n\n${JSON.stringify(record({ key: "k2" }))}\n`;
    const records = parseRecords(jsonl);
    expect(records.map((r) => r.key)).toEqual(["k", "k2"]);
  });

  it("a second tranche merges with the first rather than redoing it", () => {
    const first = parseRecords(`${JSON.stringify(record({ key: "a" }))}\n`);
    const merged = parseRecords(
      `${JSON.stringify(record({ key: "a" }))}\n${JSON.stringify(record({ key: "b" }))}\n`,
    );
    expect(first).toHaveLength(1);
    expect(merged).toHaveLength(2);
    expect(summarize(merged).records).toBe(2);
  });
});
