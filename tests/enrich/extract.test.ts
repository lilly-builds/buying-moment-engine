import { describe, expect, it } from "vitest";
import extractFixture from "./fixtures/haiku-extract-response.json";
import { FakeExtractClient, recordingMeter } from "./doubles";
import {
  anthropicCallCostUsd,
  EXTRACT_MODEL,
  EXTRACT_RATES,
  PIPELINE_STEP_EXTRACT,
  PIPELINE_STEP_RESEARCH,
  RESEARCH_RATES,
} from "@/src/enrich/config";
import { buildExtractRequestBody, runExtract } from "@/src/enrich/extract";
import {
  buildExtractPrompt,
  EXTRACT_JSON_SCHEMA,
  EXTRACT_SYSTEM_PROMPT,
} from "@/src/enrich/extract-prompt";
import { AnthropicRequestError, ZERO_USAGE, type ExtractRequest } from "@/src/enrich/types";

/**
 * The primary path: one Haiku 4.5 call over text we already hold. Every test runs
 * against a mocked client — zero paid calls. U8 is the live verification.
 */

const HOME = "https://sunshinederm.example";
const TEAM = "https://sunshinederm.example/team";
const PATIENTS = "https://sunshinederm.example/patients";

const PAGES = new Map([
  [HOME, "Sunshine Dermatology Associates is a dermatology group serving South Florida."],
  [TEAM, "Dana Whitfield, Practice Administrator"],
  [PATIENTS, "Request records through our ModMed EMA patient portal."],
]);

const REQUEST: ExtractRequest = {
  practiceName: "Sunshine Dermatology Associates",
  city: "Miami",
  state: "FL",
  pages: PAGES,
};

describe("buildExtractPrompt — the citation namespace", () => {
  it("emits one `=== SOURCE: <url> ===` header per held page, with the EXACT absolute URL", () => {
    const prompt = buildExtractPrompt(REQUEST);
    for (const url of PAGES.keys()) {
      expect(prompt).toContain(`=== SOURCE: ${url} ===`);
    }
    expect(prompt.match(/=== SOURCE: /g)).toHaveLength(3);
  });

  it("includes each page's text under its own header", () => {
    const prompt = buildExtractPrompt(REQUEST);
    expect(prompt).toContain("=== SOURCE: https://sunshinederm.example/team ===\nDana Whitfield, Practice Administrator");
  });

  it("carries the practice name and location", () => {
    const prompt = buildExtractPrompt(REQUEST);
    expect(prompt).toContain("Practice: Sunshine Dermatology Associates");
    expect(prompt).toContain("Location: Miami, FL");
  });

  it("omits the Location line when neither city nor state is known", () => {
    const prompt = buildExtractPrompt({ practiceName: "Harbor Vision", pages: PAGES });
    expect(prompt).not.toContain("Location:");
  });

  it("an empty page map yields no SOURCE header — nothing is citable", () => {
    const prompt = buildExtractPrompt({ ...REQUEST, pages: new Map() });
    expect(prompt).not.toContain("=== SOURCE:");
  });
});

describe("the prompt + schema never ask for a tally (KTD-4)", () => {
  it("the system prompt forbids providerCount and locationsCount", () => {
    expect(EXTRACT_SYSTEM_PROMPT).not.toMatch(/providerCount|locationsCount/);
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/how many locations or how many providers/i);
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/never stitch/i);
  });

  it("the JSON schema's ONLY firmographics keys are specialty, website, yearFounded", () => {
    const firmographics = EXTRACT_JSON_SCHEMA.properties.firmographics;
    expect(Object.keys(firmographics.properties)).toEqual([
      "specialty",
      "website",
      "yearFounded",
    ]);
    // Structured outputs make the shape unrepresentable, not merely rejected later.
    expect(firmographics.additionalProperties).toBe(false);
  });

  it("the E8 round-2 clause that recovered the decision-maker is still in the prompt", () => {
    // Round 1 returned `decisionMaker: none` on all three practices without it.
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/owner-physician/i);
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/founding or owner physician .* IS a valid decision-maker/i);
  });
});

/**
 * The prompt and `citations.ts` are ONE contract. A field the verifier treats as a
 * QUOTATION must be a field the prompt tells the model to quote — otherwise the verifier
 * deletes true facts and the drop row blames the model for obeying its instructions.
 * That is not hypothetical: rule 8's role vocabulary once did exactly this.
 */
describe("the prompt agrees with citations.ts about which fields are quoted", () => {
  it("names every QUOTATION field as a quoted field", () => {
    const quoted = EXTRACT_SYSTEM_PROMPT.match(/^5\. QUOTED FIELDS.*$/m)?.[0] ?? "";
    for (const field of ["ehr", "incumbentTooling", "yearFounded", "name", "role", "email"]) {
      expect(quoted, `rule 5 must name ${field}`).toContain(`"${field}"`);
    }
  });

  it("does NOT list a QUOTATION field among the labelled (exempt) fields", () => {
    const labelled = EXTRACT_SYSTEM_PROMPT.match(/^6\. LABELLED FIELDS.*$/m)?.[0] ?? "";
    expect(labelled).not.toContain('"ehr"');
    expect(labelled).not.toContain('"incumbentTooling"');
    expect(labelled).not.toContain('"role"');
  });

  it("rule 8's role list is a SEARCH vocabulary, and says the role must be copied verbatim", () => {
    // Without this, the model returns `role: "Owner-Physician"` for a physician whose page
    // prints no role noun, the verifier drops it as `value-not-in-snippet`, and the dropped
    // role collapses the entire contact — E8 round 1's regression, via the verifier.
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/not the value you return/i);
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/copied verbatim from the page/i);
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/never return a category word/i);
    // And the honest degradation, rather than an invented title.
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/prints no title or credential .* return "decisionMaker": null/i);
  });

  it("warns that a value may not be letters inside a longer word", () => {
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/WHOLE WORD or phrase/);
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/Epicare/);
  });

  it("asks for the incumbent tool's NAME as printed, not a category phrase", () => {
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/"Podium", not "Podium reviews"/);
  });
});

describe("buildExtractRequestBody — what Haiku 4.5 accepts, and what it rejects", () => {
  const body = buildExtractRequestBody(REQUEST);

  it("targets Haiku 4.5 with structured outputs on the canonical parameter", () => {
    expect(body.model).toBe(EXTRACT_MODEL);
    expect(body.model).toBe("claude-haiku-4-5");
    expect(body.output_config.format).toEqual({
      type: "json_schema",
      schema: EXTRACT_JSON_SCHEMA,
    });
  });

  it("declares NO tools — that is what makes structured outputs legal (E6)", () => {
    // `web_fetch` carries `citations: {enabled: true}`, and structured outputs are
    // documented incompatible with citations (400). No tools, no citation blocks.
    expect(body).not.toHaveProperty("tools");
  });

  it("sends no `thinking`, no `effort`, no sampling params — all error or no-op on Haiku", () => {
    expect(body).not.toHaveProperty("thinking");
    expect(body).not.toHaveProperty("effort");
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("top_p");
    expect(body).not.toHaveProperty("top_k");
  });

  it("sends no cache_control — Haiku's minimum cacheable prefix is 4,096 tokens", () => {
    // A cache_control block on this system prompt would silently no-op while implying
    // a saving that never shows up in cost_events.
    expect(JSON.stringify(body)).not.toContain("cache_control");
  });
});

describe("runExtract — a valid structured response", () => {
  it("parses into ResearchFindings, with nulls landing as absent fields", async () => {
    const { meter } = recordingMeter();
    const result = await runExtract(
      { client: FakeExtractClient.fromFixture(extractFixture), meter },
      REQUEST,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.findings.firmographics.specialty?.value).toBe("Dermatology");
    expect(result.findings.ehr?.value).toBe("ModMed EMA");
    expect(result.findings.decisionMaker?.name?.value).toBe("Dana Whitfield");
    // Haiku answers `"yearFounded": null`; the agentic path omitted the key. Same result.
    expect(result.findings.firmographics.yearFounded).toBeUndefined();
    expect(Object.keys(result.findings.firmographics)).toEqual(["specialty", "website"]);
    expect(result.model).toBe("claude-haiku-4-5");
  });

  it("hands the client the request untouched — the pages it cites are the pages we hold", async () => {
    const { meter } = recordingMeter();
    const client = FakeExtractClient.fromFixture(extractFixture);
    await runExtract({ client, meter }, REQUEST);

    expect(client.calls).toHaveLength(1);
    expect([...client.calls[0].pages.keys()]).toEqual([HOME, TEAM, PATIENTS]);
  });
});

describe("runExtract — metering (R19): parse OUTSIDE the meter", () => {
  it("writes exactly ONE cost_events row per HTTP request, on the extract step", async () => {
    const { meter, rows } = recordingMeter();
    await runExtract(
      { client: FakeExtractClient.fromFixture(extractFixture), meter, practiceId: "practice-1" },
      REQUEST,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: "anthropic",
      operation: "messages.create",
      pipelineStep: PIPELINE_STEP_EXTRACT,
      practiceId: "practice-1",
      units: 1,
    });
    // The scoreboard must be able to price the primary path against the escalation
    // it replaced, on the same practice.
    expect(PIPELINE_STEP_EXTRACT).not.toBe(PIPELINE_STEP_RESEARCH);
  });

  it("prices at HAIKU's rate card, not Sonnet's", async () => {
    const { meter, rows } = recordingMeter();
    await runExtract({ client: FakeExtractClient.fromFixture(extractFixture), meter }, REQUEST);

    // 9,412 input @ $1/MTok + 318 output @ $5/MTok.
    const expected = 9_412 / 1_000_000 + (318 * 5) / 1_000_000;
    expect(rows[0].costUsd).toBeCloseTo(expected, 12);
    expect(rows[0].costUsd).toBeCloseTo(0.011002, 6);
    // The E5 band. If a live run leaves it, stop and investigate before believing it.
    expect(rows[0].costUsd).toBeLessThan(0.02);
    // Priced as Sonnet this same call would be 3x — the bug an implicit default invites.
    expect(anthropicCallCostUsd({ ...ZERO_USAGE, inputTokens: 9_412, outputTokens: 318 }, RESEARCH_RATES))
      .toBeCloseTo(expected * 3, 10);
  });

  it("carries the token breakdown and the model it PRICED AT into meta", async () => {
    const { meter, rows } = recordingMeter();
    await runExtract({ client: FakeExtractClient.fromFixture(extractFixture), meter }, REQUEST);

    expect(rows[0].meta).toMatchObject({
      model: "claude-haiku-4-5",
      inputTokens: 9_412,
      outputTokens: 318,
      webSearchRequests: 0,
      webSearchUsd: 0,
      practiceName: "Sunshine Dermatology Associates",
      pagesHeld: 3,
    });
    expect(rows[0].meta).not.toHaveProperty("unpriced");
  });

  it("a BILLED 200 whose body fails zod still writes a cost row, and does not throw", async () => {
    const { meter, rows } = recordingMeter();
    const result = await runExtract({ client: FakeExtractClient.malformed(), meter }, REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/malformed JSON/);

    // Anthropic charged for this. A throw here would record nothing and understate CAC
    // exactly on the calls that went wrong.
    expect(rows).toHaveLength(1);
    expect(rows[0].costUsd).toBeGreaterThan(0);
    expect(rows[0].meta).toMatchObject({ inputTokens: 9_000 });
  });

  it("an unrecognizable 200 body writes a row flagged `unpriced`, with a reason", async () => {
    const { meter, rows } = recordingMeter();
    const client = FakeExtractClient.fromFixture({ not: "a messages response" });
    const result = await runExtract({ client, meter }, REQUEST);

    expect(result.ok).toBe(false);
    expect(rows).toHaveLength(1);
    expect(rows[0].costUsd).toBe(0);
    expect(rows[0].meta).toMatchObject({ unpriced: true, reason: "unparseable-envelope" });
    // Labelled with the model WE called, never the agentic default.
    expect(rows[0].meta).toMatchObject({ model: "claude-haiku-4-5" });
  });

  it("a non-2xx THROWS and the meter records nothing — an unbilled call costs $0", async () => {
    const { meter, rows } = recordingMeter();
    const client = FakeExtractClient.throwing(new AnthropicRequestError(429, "rate limited"));

    await expect(runExtract({ client, meter }, REQUEST)).rejects.toThrow(/429/);
    expect(rows).toEqual([]);
  });
});

describe("cost math against the published Haiku rate card", () => {
  it("$1 / input MTok, $5 / output MTok", () => {
    const usage = { ...ZERO_USAGE, inputTokens: 1_000_000, outputTokens: 1_000_000 };
    expect(anthropicCallCostUsd(usage, EXTRACT_RATES)).toBeCloseTo(6, 10);
  });

  it("cache writes at 1.25x and reads at 0.1x the model's OWN base input rate", () => {
    const usage = { ...ZERO_USAGE, cacheCreationInputTokens: 1_000_000, cacheReadInputTokens: 1_000_000 };
    expect(anthropicCallCostUsd(usage, EXTRACT_RATES)).toBeCloseTo(1 * 1.25 + 1 * 0.1, 10);
  });

  it("the extract path carries no server-tool surcharge — it browses nothing", () => {
    const usage = { ...ZERO_USAGE, inputTokens: 10_000 };
    expect(anthropicCallCostUsd(usage, EXTRACT_RATES)).toBeCloseTo(0.01, 10);
  });
});
