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
  normalizePersonSearchResponse,
  pdlClient,
} from "@/src/enrich/pdl-client";
import {
  runPdlCompanyEnrich,
  runPdlPersonDiscover,
  runPdlPersonEnrich,
} from "@/src/enrich/pdl";
import { PdlRateLimitError } from "@/src/enrich/types";

const PERSON = {
  fullName: "Dana Whitfield",
  companyName: "Sunshine Dermatology Associates",
  role: "Practice Administrator",
};

const DISCOVERY = {
  companyName: "Harbor Vision Eye Care",
  city: "Portland",
  state: "OR",
  targetRoles: ["practice administrator", "office manager"],
};

describe("PDL response normalization (published Person Enrichment schema)", () => {
  it("maps a matched record to the verified work email + LinkedIn URL", () => {
    const result = normalizePersonResponse(personMatch, 200);
    expect(result).toEqual({
      billed: true,
      matched: true,
      unparseable: false,
      parseError: null,
      likelihood: 8,
      workEmail: "dana.whitfield@sunshinederm.example",
      linkedinUrl: "linkedin.com/in/dana-whitfield-example",
      // A plan that returns the STRING is not withholding anything.
      emailWithheldByPlan: false,
      linkedinWithheldByPlan: false,
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
      unparseable: false, // a 404 is understood perfectly; it just has no record
      parseError: null,
      likelihood: null,
      workEmail: null,
      linkedinUrl: null,
      emailWithheldByPlan: false, // a no-match tells us nothing about what PDL holds
      linkedinWithheldByPlan: false,
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
    expect(normalizePersonResponse({ unexpected: true }, 200).matched).toBe(
      false,
    );
    expect(normalizeCompanyResponse(null, 404).matched).toBe(false);
  });
});

describe("PDL Person Search discovery", () => {
  it("accepts a confident business decision-maker and surfaces only work contact fields", async () => {
    const searchBody = {
      status: 200,
      total: 1,
      data: [
        {
          full_name: "Dana Whitfield",
          job_title: "Office Manager",
          job_company_name: "Harbor Vision Eye Care",
          location_locality: "Portland",
          location_region: "Oregon",
          work_email: "dana@harborvision.example",
          recommended_personal_email: "do-not-use@example.invalid",
          linkedin_url: "linkedin.com/in/dana-whitfield-example",
        },
      ],
    };

    expect(normalizePersonSearchResponse(searchBody, DISCOVERY)).toMatchObject({
      billedRecords: 1,
      matched: true,
      confidence: expect.any(Number),
      fullName: "Dana Whitfield",
      role: "Office Manager",
      workEmail: "dana@harborvision.example",
      linkedinUrl: "linkedin.com/in/dana-whitfield-example",
    });
  });

  it("rejects weak candidates but still meters the returned search record", async () => {
    const weak = {
      billedRecords: 1,
      matched: false,
      unparseable: false,
      parseError: null,
      total: 1,
      confidence: 0.3,
      fullName: null,
      role: null,
      companyName: null,
      workEmail: null,
      linkedinUrl: null,
    };
    const client = FakePdlClient.withDiscovery(weak, personNotFound);
    const { meter, rows } = recordingMeter();

    await runPdlPersonDiscover({ client, meter }, DISCOVERY);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: "pdl",
      operation: "person.search",
      units: 1,
      costUsd: PDL_USD_PER_MATCHED_RECORD,
    });
    expect(rows[0].meta).toMatchObject({ matched: false, confidence: 0.3 });
  });
});

describe("BILLED vs MATCHED — PDL charges on the HTTP 200, not on our judgement", () => {
  it("a 200 whose body we do not recognize is BILLED, and the meter charges units=1", async () => {
    // Real spend, zero usable data. Metering on `matched` books this at $0.
    const unrecognized = { data: { some: "shape we have never seen" } };
    expect(normalizePersonResponse(unrecognized, 200)).toEqual({
      billed: true,
      matched: false,
      // We do not understand this payload. Say so, out loud, in the result — a
      // silent no-match here reports our own bug as the vendor's missing data.
      unparseable: true,
      parseError: expect.any(String),
      likelihood: null,
      workEmail: null,
      linkedinUrl: null,
      emailWithheldByPlan: false,
      linkedinWithheldByPlan: false,
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
    // PDL returned a person and charged for it; we refuse to USE it (D9).
    const result = normalizePersonResponse(personLowLikelihood, 200);
    expect(result.billed).toBe(true);
    expect(result.matched).toBe(false);

    const client = FakePdlClient.fromFixture(personLowLikelihood);
    const { meter, rows } = recordingMeter();
    await runPdlPersonEnrich({ client, meter }, PERSON);

    expect(rows).toHaveLength(1);
    expect(rows[0].units).toBe(1);
    expect(rows[0].costUsd).toBeCloseTo(PDL_USD_PER_MATCHED_RECORD, 10);
    expect(rows[0].meta).toMatchObject({
      billed: true,
      matched: false,
      likelihood: 3,
    });
  });
});

describe("the real PDL client over a stubbed fetch — a billed 200 never throws", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a 200 whose BODY STREAM dies mid-read is still billed, so it still writes a row", async () => {
    // The 200 header is the billing event; `res.text()` rejecting afterwards must not
    // unwind past the meter.
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

/**
 * REGRESSION — the free-tier licence convention.
 *
 * PDL returns the literal boolean `false` for a field your plan is not licensed for.
 * Typing `work_email` as `z.string()` made the whole payload fail to parse, and the
 * normalizer reported the person as unmatched — so a real, BILLED match (likelihood 9,
 * 77 fields, a usable LinkedIn URL) was thrown away and recorded as "PDL had no data."
 *
 * Payload shape captured from a live positive-control call, 2026-07-08.
 */
describe("licence-gated fields (`false`) must not be read as 'no data'", () => {
  const freeTierMatch = {
    status: 200,
    likelihood: 9,
    data: {
      full_name: "sean thorne",
      job_title: "president",
      work_email: false, // ← not licensed on the free tier
      recommended_personal_email: false,
      linkedin_url: "linkedin.com/in/seanthorne",
    },
  };

  it("parses a free-tier 200 as a MATCH, keeping the LinkedIn URL it did return", () => {
    const r = normalizePersonResponse(freeTierMatch, 200);
    expect(r.unparseable).toBe(false);
    expect(r.matched).toBe(true);
    expect(r.billed).toBe(true);
    expect(r.linkedinUrl).toBe("linkedin.com/in/seanthorne");
  });

  it("`false` means PDL HOLDS NOTHING — paying would buy nothing", () => {
    const r = normalizePersonResponse(freeTierMatch, 200);
    expect(r.workEmail).toBeNull();
    // PDL docs: on a free plan a restricted field is `true` if the value exists and
    // `false` if it does not. So `false` is NOT "upgrade to see it".
    expect(r.emailWithheldByPlan).toBe(false);
  });

  it("`true` means PDL HOLDS IT and the plan withholds it — paying WOULD reveal it", () => {
    // Live shape (2026-07-08): one record carrying a string, a `true`, and a `false`.
    const mixed = {
      status: 200,
      likelihood: 9,
      data: {
        work_email: true, // exists, withheld by plan
        recommended_personal_email: true,
        linkedin_url: "linkedin.com/in/satyanadella", // unrestricted -> a real string
      },
    };
    const r = normalizePersonResponse(mixed, 200);
    expect(r.matched).toBe(true);
    expect(r.workEmail).toBeNull(); // we still have no value...
    expect(r.emailWithheldByPlan).toBe(true); // ...but paying would produce one
    expect(r.linkedinUrl).toBe("linkedin.com/in/satyanadella");
    expect(r.linkedinWithheldByPlan).toBe(false);
  });

  it("a 200 we genuinely cannot parse is LOUD, never a silent no-match", () => {
    const garbage = { status: 200, data: { work_email: { nested: "object" } } };
    const r = normalizePersonResponse(garbage, 200);
    expect(r.unparseable).toBe(true);
    expect(r.parseError).toBeTruthy();
    expect(r.billed).toBe(true); // PDL charged for it either way
    expect(r.matched).toBe(false);
  });

  it("a true 404 is a no-match, unbilled, and NOT flagged unparseable", () => {
    const r = normalizePersonResponse({ status: 404 }, 404);
    expect(r.matched).toBe(false);
    expect(r.unparseable).toBe(false);
    expect(r.billed).toBe(false);
  });
});
