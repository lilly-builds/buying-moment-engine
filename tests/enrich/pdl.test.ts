import { describe, expect, it } from "vitest";
import companyMatch from "./fixtures/pdl-company-enrich-match.json";
import personLowLikelihood from "./fixtures/pdl-person-enrich-low-likelihood.json";
import personMatch from "./fixtures/pdl-person-enrich-match.json";
import personNotFound from "./fixtures/pdl-person-enrich-404.json";
import { FakePdlClient, recordingMeter } from "./doubles";
import { PDL_USD_PER_MATCHED_RECORD } from "@/src/enrich/config";
import {
  normalizeCompanyResponse,
  normalizePersonResponse,
} from "@/src/enrich/pdl-client";
import { runPdlCompanyEnrich, runPdlPersonEnrich } from "@/src/enrich/pdl";
import { PdlRateLimitError } from "@/src/enrich/types";

const PERSON = {
  fullName: "Dana Whitfield",
  companyName: "Sunshine Dermatology Associates",
  role: "Practice Administrator",
};

describe("PDL response normalization (published Person Enrichment schema)", () => {
  it("maps a matched record to the verified work email + LinkedIn URL", () => {
    const result = normalizePersonResponse(personMatch);
    expect(result).toEqual({
      matched: true,
      likelihood: 8,
      workEmail: "dana.whitfield@sunshinederm.example",
      linkedinUrl: "linkedin.com/in/dana-whitfield-example",
    });
  });

  it("never surfaces recommended_personal_email — business contacts only (D9)", () => {
    const result = normalizePersonResponse(personMatch);
    expect(JSON.stringify(result)).not.toContain("example-mail.invalid");
  });

  it("ERROR PATH: a 404 no-match yields matched=false, not a throw", () => {
    expect(normalizePersonResponse(personNotFound)).toEqual({
      matched: false,
      likelihood: null,
      workEmail: null,
      linkedinUrl: null,
    });
  });

  it("EDGE CASE: a below-threshold likelihood is treated as NO match", () => {
    const result = normalizePersonResponse(personLowLikelihood);
    expect(result.matched).toBe(false);
    expect(result.workEmail).toBeNull();
    expect(result.likelihood).toBe(3);
  });

  it("maps a matched company record (used only by experiment #1)", () => {
    expect(normalizeCompanyResponse(companyMatch)).toEqual({
      matched: true,
      likelihood: 9,
      employeeCount: 48,
      locationsCount: 3,
      industry: "medical practice",
      website: "sunshinederm.example",
    });
  });

  it("EDGE CASE: an unrecognized body degrades to no-match, never a crash", () => {
    expect(normalizePersonResponse({ unexpected: true }).matched).toBe(false);
    expect(normalizeCompanyResponse(null).matched).toBe(false);
  });
});

describe("metering PDL (R19) — billed per MATCHED record", () => {
  it("a matched record records units=1 at the published per-record price", async () => {
    const client = FakePdlClient.fromFixture(personMatch);
    const { meter, rows } = recordingMeter();

    const result = await runPdlPersonEnrich(
      { client, meter, practiceId: "practice-1" },
      PERSON,
    );

    expect(result.matched).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: "pdl",
      operation: "person.enrich",
      pipelineStep: "enrich.pdl",
      practiceId: "practice-1",
      units: 1,
      unitCostUsd: PDL_USD_PER_MATCHED_RECORD,
    });
    expect(rows[0].costUsd).toBeCloseTo(PDL_USD_PER_MATCHED_RECORD, 10);
  });

  it("a 404 no-match still writes a cost row, at units=0 / $0", async () => {
    const client = FakePdlClient.fromFixture(personNotFound);
    const { meter, rows } = recordingMeter();

    await runPdlPersonEnrich({ client, meter }, PERSON);

    expect(rows).toHaveLength(1);
    expect(rows[0].units).toBe(0);
    expect(rows[0].costUsd).toBe(0);
    expect(rows[0].meta).toMatchObject({ matched: false });
  });

  it("ERROR PATH: a 429 is unbilled — it throws and records no cost row", async () => {
    const client = FakePdlClient.throwing(new PdlRateLimitError(30));
    const { meter, rows } = recordingMeter();

    await expect(runPdlPersonEnrich({ client, meter }, PERSON)).rejects.toThrow(
      PdlRateLimitError,
    );
    expect(rows).toHaveLength(0);
  });

  it("ERROR PATH: a network timeout is unbilled and records no cost row", async () => {
    const client = FakePdlClient.throwing(
      new DOMException("The operation timed out.", "TimeoutError"),
    );
    const { meter, rows } = recordingMeter();

    await expect(runPdlPersonEnrich({ client, meter }, PERSON)).rejects.toThrow(
      /timed out/,
    );
    expect(rows).toHaveLength(0);
  });

  it("company enrichment is metered too (experiment #1's paid calls)", async () => {
    const client = new FakePdlClient(
      async () => normalizePersonResponse(personNotFound),
      async () => normalizeCompanyResponse(companyMatch),
    );
    const { meter, rows } = recordingMeter();

    const result = await runPdlCompanyEnrich(
      { client, meter },
      { companyName: "Sunshine Dermatology Associates" },
    );

    expect(result.locationsCount).toBe(3);
    expect(rows).toHaveLength(1);
    expect(rows[0].operation).toBe("company.enrich");
    expect(rows[0].units).toBe(1);
  });
});
