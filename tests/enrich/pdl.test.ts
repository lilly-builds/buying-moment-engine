import { afterEach, describe, expect, it, vi } from "vitest";
import companyMatch from "./fixtures/pdl-company-enrich-match.json";
import personLowLikelihood from "./fixtures/pdl-person-enrich-low-likelihood.json";
import personMatch from "./fixtures/pdl-person-enrich-match.json";
import personNotFound from "./fixtures/pdl-person-enrich-404.json";
import { FakePdlClient, recordingMeter } from "./doubles";
import { PDL_USD_PER_MATCHED_RECORD } from "@/src/enrich/config";
import {
  normalizeCompanyResponse,
  normalizePersonResponse,
  pdlClient,
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
    const result = normalizePersonResponse(personMatch, 200);
    expect(result).toEqual({
      billed: true,
      matched: true,
      likelihood: 8,
      workEmail: "dana.whitfield@sunshinederm.example",
      linkedinUrl: "linkedin.com/in/dana-whitfield-example",
    });
  });

  it("never surfaces recommended_personal_email — business contacts only (D9)", () => {
    const result = normalizePersonResponse(personMatch, 200);
    expect(JSON.stringify(result)).not.toContain("example-mail.invalid");
  });

  it("ERROR PATH: a 404 no-match yields matched=false, not a throw — and is UNBILLED", () => {
    expect(normalizePersonResponse(personNotFound, 404)).toEqual({
      billed: false,
      matched: false,
      likelihood: null,
      workEmail: null,
      linkedinUrl: null,
    });
  });

  it("EDGE CASE: a below-threshold likelihood is treated as NO match", () => {
    const result = normalizePersonResponse(personLowLikelihood, 200);
    expect(result.matched).toBe(false);
    expect(result.workEmail).toBeNull();
    expect(result.likelihood).toBe(3);
  });

  it("maps a matched company record (used only by experiment #1)", () => {
    expect(normalizeCompanyResponse(companyMatch, 200)).toEqual({
      billed: true,
      matched: true,
      likelihood: 9,
      employeeCount: 48,
      locationsCount: 3,
      industry: "medical practice",
      website: "sunshinederm.example",
    });
  });

  it("EDGE CASE: an unrecognized body degrades to no-match, never a crash", () => {
    expect(normalizePersonResponse({ unexpected: true }, 200).matched).toBe(false);
    expect(normalizeCompanyResponse(null, 404).matched).toBe(false);
  });
});

describe("BILLED vs MATCHED — PDL charges on the HTTP 200, not on our judgement", () => {
  it("a 200 whose body we do not recognize is BILLED, and the meter charges units=1", async () => {
    // Real spend, zero usable data. Metering on `matched` would book this at $0.
    const unrecognized = { data: { some: "shape we have never seen" } };
    expect(normalizePersonResponse(unrecognized, 200)).toEqual({
      billed: true,
      matched: false,
      likelihood: null,
      workEmail: null,
      linkedinUrl: null,
    });

    const client = FakePdlClient.fromFixture(unrecognized);
    const { meter, rows } = recordingMeter();
    await runPdlPersonEnrich({ client, meter }, PERSON);

    expect(rows).toHaveLength(1);
    expect(rows[0].units).toBe(1);
    expect(rows[0].costUsd).toBeCloseTo(PDL_USD_PER_MATCHED_RECORD, 10);
    expect(rows[0].meta).toMatchObject({ billed: true, matched: false });
  });

  it("a 200 below the likelihood threshold is BILLED, and the meter charges units=1", async () => {
    // PDL returned a person and charged for it; we refuse to USE it (D9). The
    // refusal is ours, the invoice is theirs.
    const result = normalizePersonResponse(personLowLikelihood, 200);
    expect(result.billed).toBe(true);
    expect(result.matched).toBe(false);

    const client = FakePdlClient.fromFixture(personLowLikelihood);
    const { meter, rows } = recordingMeter();
    await runPdlPersonEnrich({ client, meter }, PERSON);

    expect(rows).toHaveLength(1);
    expect(rows[0].units).toBe(1);
    expect(rows[0].costUsd).toBeCloseTo(PDL_USD_PER_MATCHED_RECORD, 10);
    expect(rows[0].meta).toMatchObject({ billed: true, matched: false, likelihood: 3 });
  });
});

describe("the real PDL client over a stubbed fetch — a billed 200 never throws", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a 200 whose BODY STREAM dies mid-read is still billed, so it still writes a row", async () => {
    // The 200 header is the billing event; `res.text()` rejecting afterwards must not
    // unwind past the meter. Guarding only `JSON.parse` would leave this path throwing.
    vi.stubGlobal("fetch", async () => {
      const body = new ReadableStream({
        start(controller) {
          controller.error(new Error("socket hang up"));
        },
      });
      return new Response(body, { status: 200 });
    });
    const { meter, rows } = recordingMeter();

    const result = await runPdlPersonEnrich(
      { client: pdlClient("test-key-not-a-real-secret"), meter },
      PERSON,
    );

    expect(result).toMatchObject({ billed: true, matched: false });
    expect(rows).toHaveLength(1);
    expect(rows[0].units).toBe(1);
    expect(rows[0].costUsd).toBeCloseTo(PDL_USD_PER_MATCHED_RECORD, 10);
  });

  it("a 200 of non-JSON (an edge/proxy HTML page) is billed, not a crash", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response("<html>200 OK</html>", { status: 200 }),
    );
    const { meter, rows } = recordingMeter();

    const result = await runPdlPersonEnrich(
      { client: pdlClient("test-key-not-a-real-secret"), meter },
      PERSON,
    );

    expect(result).toMatchObject({ billed: true, matched: false });
    expect(rows[0].units).toBe(1);
  });

  it("ERROR PATH: a 404 through the real client is UNBILLED", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ status: 404 }), { status: 404 }),
    );
    const { meter, rows } = recordingMeter();

    const result = await runPdlPersonEnrich(
      { client: pdlClient("test-key-not-a-real-secret"), meter },
      PERSON,
    );

    expect(result).toMatchObject({ billed: false, matched: false });
    expect(rows[0].units).toBe(0);
    expect(rows[0].costUsd).toBe(0);
  });
});

describe("metering PDL (R19) — billed per BILLED record (HTTP 200)", () => {
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
    expect(rows[0].meta).toMatchObject({ billed: false, matched: false });
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
      async () => normalizePersonResponse(personNotFound, 404),
      async () => normalizeCompanyResponse(companyMatch, 200),
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
