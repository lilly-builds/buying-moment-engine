import { describe, expect, it } from "vitest";
import classifyFixture from "./fixtures/haiku-classify-response.json";
import { FakeClassifyClient, recordingMeter } from "./doubles";
import {
  anthropicCallCostUsd,
  RESEARCH_RATES,
} from "@/src/enrich/config";
import { AnthropicRequestError, ZERO_USAGE } from "@/src/enrich/types";
import {
  buildClassifyRequestBody,
  runClassify,
  type ClassifyRequest,
} from "@/src/discovery/classify";
import {
  buildClassifyPrompt,
  CLASSIFY_JSON_SCHEMA,
  CLASSIFY_SYSTEM_PROMPT,
} from "@/src/discovery/classify-prompt";
import { CLASSIFY_MODEL, PIPELINE_STEP_CLASSIFY } from "@/src/discovery/config";
import { parseClassifyOutput } from "@/src/discovery/classify-schema";

const ELISE_PROMPT =
  "The reviewer describes trouble reaching the practice by phone: long holds, calls not answered, no callback, full voicemail.";
const REVIEW_PHONE_PAIN =
  "I've been trying for weeks — I can't get through on the phone at all, and when I do I'm always on hold.";

const REQUEST: ClassifyRequest = {
  qualificationPrompt: ELISE_PROMPT,
  reviewText: REVIEW_PHONE_PAIN,
};

describe("buildClassifyPrompt — the swappable per-tenant criterion (R8)", () => {
  it("embeds the tenant criterion AND the review under labelled sections", () => {
    const prompt = buildClassifyPrompt(ELISE_PROMPT, REVIEW_PHONE_PAIN);
    expect(prompt).toContain("QUALIFICATION CRITERION");
    expect(prompt).toContain(ELISE_PROMPT);
    expect(prompt).toContain("REVIEW:");
    expect(prompt).toContain(REVIEW_PHONE_PAIN);
  });

  it("two different tenant criteria produce DIFFERENT user messages (genuinely parameterized)", () => {
    const a = buildClassifyPrompt("bad phone access", REVIEW_PHONE_PAIN);
    const b = buildClassifyPrompt("long wait times in the waiting room", REVIEW_PHONE_PAIN);
    expect(a).not.toBe(b);
    expect(a).toContain("bad phone access");
    expect(b).toContain("long wait times in the waiting room");
  });
});

describe("CLASSIFY_SYSTEM_PROMPT — the precision guard", () => {
  it("says a positive/neutral mention does NOT qualify", () => {
    expect(CLASSIFY_SYSTEM_PROMPT).toMatch(/positive or neutral mention .* does not qualify/i);
    expect(CLASSIFY_SYSTEM_PROMPT).toMatch(/lovely on the phone/i);
  });

  it("says an off-topic complaint does NOT qualify, and to default to false when in doubt", () => {
    expect(CLASSIFY_SYSTEM_PROMPT).toMatch(/off-topic complaint does not qualify/i);
    expect(CLASSIFY_SYSTEM_PROMPT).toMatch(/when in doubt, return qualifies=false/i);
  });

  it("forbids echoing the review text back (R5)", () => {
    expect(CLASSIFY_SYSTEM_PROMPT).toMatch(/never quote, paraphrase, or echo the review text/i);
  });
});

describe("buildClassifyRequestBody — what Haiku 4.5 accepts, and what it rejects", () => {
  const body = buildClassifyRequestBody(REQUEST);

  it("targets Haiku 4.5 with structured outputs on the canonical parameter", () => {
    expect(body.model).toBe(CLASSIFY_MODEL);
    expect(body.model).toBe("claude-haiku-4-5");
    expect(body.output_config.format).toEqual({
      type: "json_schema",
      schema: CLASSIFY_JSON_SCHEMA,
    });
  });

  it("declares no tools, no thinking/effort/sampling params, no cache_control", () => {
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("thinking");
    expect(body).not.toHaveProperty("effort");
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("top_p");
    expect(JSON.stringify(body)).not.toContain("cache_control");
  });

  it("puts the review text in the user turn (transiently sent, never a system constant)", () => {
    expect(body.messages[0].content).toContain(REVIEW_PHONE_PAIN);
    expect(CLASSIFY_SYSTEM_PROMPT).not.toContain(REVIEW_PHONE_PAIN);
  });
});

describe("runClassify — a valid structured verdict", () => {
  it("parses the fixture into { qualifies, confidence, category }", async () => {
    const { meter } = recordingMeter();
    const result = await runClassify(
      { client: FakeClassifyClient.fromFixture(classifyFixture), meter },
      REQUEST,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toEqual({
      qualifies: true,
      confidence: 0.86,
      category: "cannot-get-through",
    });
    expect(result.model).toBe("claude-haiku-4-5");
  });

  it("carries a model's qualifies=false verdict through unchanged (the precision outcome)", async () => {
    const { meter } = recordingMeter();
    const client = FakeClassifyClient.fromVerdict({
      qualifies: false,
      confidence: 0.9,
      category: "none",
    });
    const result = await runClassify({ client, meter }, {
      qualificationPrompt: ELISE_PROMPT,
      reviewText: "The staff were lovely on the phone and picked up right away.",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.qualifies).toBe(false);
    expect(result.result.category).toBe("none");
  });
});

describe("runClassify — metering (R6): parse OUTSIDE the meter", () => {
  it("writes exactly ONE cost row, priced at HAIKU, with practiceId null on the discovery step", async () => {
    const { meter, rows } = recordingMeter();
    await runClassify({ client: FakeClassifyClient.fromFixture(classifyFixture), meter }, REQUEST);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: "anthropic",
      operation: "messages.create",
      pipelineStep: PIPELINE_STEP_CLASSIFY,
      practiceId: null,
      units: 1,
    });
    // 512 input @ $1/MTok + 24 output @ $5/MTok, at Haiku's card.
    const expected = 512 / 1_000_000 + (24 * 5) / 1_000_000;
    expect(rows[0].costUsd).toBeCloseTo(expected, 12);
    // Priced as Sonnet this same call would be 3x — the bug an implicit default invites.
    expect(
      anthropicCallCostUsd({ ...ZERO_USAGE, inputTokens: 512, outputTokens: 24 }, RESEARCH_RATES),
    ).toBeCloseTo(expected * 3, 10);
  });

  it("never puts review text in the cost row meta (R5)", async () => {
    const { meter, rows } = recordingMeter();
    await runClassify({ client: FakeClassifyClient.fromFixture(classifyFixture), meter }, REQUEST);
    expect(JSON.stringify(rows[0].meta)).not.toContain("can't get through");
    expect(JSON.stringify(rows[0].meta)).not.toContain(REVIEW_PHONE_PAIN);
  });

  it("a BILLED 200 whose body fails to parse still records a row and does not throw", async () => {
    const { meter, rows } = recordingMeter();
    const result = await runClassify({ client: FakeClassifyClient.malformed(), meter }, REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/malformed JSON/);
    expect(rows).toHaveLength(1);
    expect(rows[0].costUsd).toBeGreaterThan(0);
  });

  it("a non-2xx THROWS and the meter records nothing — an unbilled call costs $0", async () => {
    const { meter, rows } = recordingMeter();
    const client = FakeClassifyClient.throwing(new AnthropicRequestError(429, "rate limited"));
    await expect(runClassify({ client, meter }, REQUEST)).rejects.toThrow(/429/);
    expect(rows).toEqual([]);
  });

  it("the client is handed the review text, but runClassify never returns it (R5)", async () => {
    const { meter } = recordingMeter();
    const client = FakeClassifyClient.fromFixture(classifyFixture);
    const result = await runClassify({ client, meter }, REQUEST);

    // The review reached the client (it must, to be judged)...
    expect(client.calls[0].reviewText).toBe(REVIEW_PHONE_PAIN);
    // ...but the resolved verdict carries only our derived fields, no review text.
    expect(JSON.stringify(result)).not.toContain(REVIEW_PHONE_PAIN);
  });
});

describe("parseClassifyOutput — never throws", () => {
  it("rejects a non-JSON body with a reason instead of throwing", () => {
    const parsed = parseClassifyOutput("not json at all");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toMatch(/malformed JSON/);
  });

  it("rejects a body whose confidence is out of range", () => {
    const parsed = parseClassifyOutput('{"qualifies": true, "confidence": 4, "category": "x"}');
    expect(parsed.ok).toBe(false);
  });

  it("accepts a well-formed verdict", () => {
    const parsed = parseClassifyOutput('{"qualifies": false, "confidence": 0.1, "category": "none"}');
    expect(parsed.ok).toBe(true);
  });
});
