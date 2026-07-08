import { afterEach, describe, expect, it, vi } from "vitest";
import researchFixture from "./fixtures/anthropic-research-response.json";
import { FakeResearchClient, recordingMeter } from "./doubles";
import {
  anthropicResearchClient,
  buildRequestBody,
  collectText,
  EMPTY_STREAM,
  normalizeUsage,
} from "@/src/enrich/anthropic-client";
import {
  ANTHROPIC_INPUT_USD_PER_TOKEN,
  ANTHROPIC_OUTPUT_USD_PER_TOKEN,
  anthropicCallCostUsd,
  RESEARCH_RATES,
  RESEARCH_MODEL,
  WEB_FETCH_TOOL_TYPE,
  WEB_SEARCH_TOOL_TYPE,
  WEB_SEARCH_USD_PER_REQUEST,
} from "@/src/enrich/config";
import { runResearch } from "@/src/enrich/research";
import {
  buildResearchPrompt,
  RESEARCH_SYSTEM_PROMPT,
} from "@/src/enrich/research-prompt";
import {
  extractJsonObject,
  isEmptyFindings,
  parseResearchOutput,
} from "@/src/enrich/research-schema";
import { AnthropicRequestError, ZERO_USAGE } from "@/src/enrich/types";

const REQUEST = {
  practiceName: "Sunshine Dermatology Associates",
  city: "Miami",
  state: "FL",
};

describe("citation closure (D2/R5)", () => {
  it("SCENARIO 2: firmographics / EHR / decision-maker each carry a source URL", async () => {
    const client = FakeResearchClient.fromFixture(researchFixture);
    const { meter } = recordingMeter();

    const outcome = await runResearch({ client, meter }, REQUEST);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const f = outcome.findings;
    expect(f.firmographics.specialty?.sourceUrl).toBe(
      "https://sunshinederm.example/about",
    );
    expect(f.firmographics.specialty?.snippet).toContain("dermatology group");
    expect(f.firmographics.website?.sourceUrl).toBe(
      "https://sunshinederm.example/about",
    );
    expect(f.ehr?.value).toBe("ModMed EMA");
    expect(f.ehr?.sourceUrl).toBe("https://sunshinederm.example/patient-portal");
    expect(f.decisionMaker?.name?.value).toBe("Dana Whitfield");
    expect(f.decisionMaker?.name?.sourceUrl).toBe(
      "https://sunshinederm.example/team",
    );
    expect(f.decisionMaker?.role.sourceUrl).toBe(
      "https://sunshinederm.example/team",
    );
    expect(f.buyingMomentContext[0].sourceUrl).toBe(
      "https://sunshinederm.example/news/hialeah",
    );

    // Structural: EVERY leaf fact has a non-empty url + snippet.
    const leaves = [
      ...Object.values(f.firmographics),
      ...(f.ehr ? [f.ehr] : []),
      ...f.incumbentTooling,
      ...f.buyingMomentContext,
      ...(f.decisionMaker?.name ? [f.decisionMaker.name] : []),
      ...(f.decisionMaker ? [f.decisionMaker.role] : []),
    ];
    expect(leaves.length).toBeGreaterThan(0);
    for (const leaf of leaves) {
      expect(leaf.sourceUrl).toMatch(/^https?:\/\//);
      expect(leaf.snippet.length).toBeGreaterThan(0);
    }
  });

  it("rejects an uncited fact — the LLM cannot introduce one", () => {
    const uncited = JSON.stringify({
      firmographics: {
        specialty: { value: "Dermatology", snippet: "trust me" },
      },
    });
    const result = parseResearchOutput(uncited);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("sourceUrl");
  });

  it("rejects a fact whose sourceUrl is not a URL", () => {
    const bad = JSON.stringify({
      firmographics: {
        specialty: { value: "Derm", sourceUrl: "their website", snippet: "x" },
      },
    });
    expect(parseResearchOutput(bad).ok).toBe(false);
  });

  it("rejects a fact with an empty snippet (a link is not proof)", () => {
    const bad = JSON.stringify({
      ehr: { value: "ModMed", sourceUrl: "https://x.example", snippet: "" },
    });
    expect(parseResearchOutput(bad).ok).toBe(false);
  });

  it("KTD-4: an UNKNOWN firmographics key is rejected, not silently accepted", () => {
    // `z.record()` used to wave anything through, including the derived tallies a
    // model can only produce by stitching. `z.strictObject` is the gate now.
    const bad = JSON.stringify({
      firmographics: {
        providerCount: {
          value: "3",
          sourceUrl: "https://x.example/team",
          snippet: "Dr. A, Dr. B, Dr. C",
        },
      },
    });
    const result = parseResearchOutput(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/providerCount/);
  });

  it("accepts the three fields a page can actually STATE", () => {
    const good = JSON.stringify({
      firmographics: {
        specialty: { value: "Dermatology", sourceUrl: "https://x.example", snippet: "a dermatology group" },
        website: { value: "https://x.example", sourceUrl: "https://x.example", snippet: "a dermatology group" },
        yearFounded: { value: "2004", sourceUrl: "https://x.example", snippet: "founded in 2004" },
      },
    });
    const result = parseResearchOutput(good);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.findings.firmographics.yearFounded?.value).toBe("2004");
  });
});

describe("KTD-4 prompt guard — the model is never ASKED for a tally", () => {
  it("the escalation prompt does not request locationsCount or providerCount", () => {
    // A schema that rejects a field the prompt still asks for produces a parse
    // failure on a billed call. Both ends have to agree.
    expect(RESEARCH_SYSTEM_PROMPT).not.toMatch(/"locationsCount"|"providerCount"/);
    expect(RESEARCH_SYSTEM_PROMPT).toMatch(/Do NOT report how many locations/);
    expect(buildResearchPrompt(REQUEST)).not.toMatch(/how many locations, how many providers/);
  });
});

describe("research output parsing", () => {
  it("extracts a JSON object surrounded by prose", () => {
    const text = 'Here you go:\n{"a": {"b": "}"}}\nHope that helps.';
    expect(extractJsonObject(text)).toBe('{"a": {"b": "}"}}');
  });

  it("returns null when no JSON object is present", () => {
    expect(extractJsonObject("I could not find anything.")).toBeNull();
  });

  it("ERROR PATH: malformed JSON fails loud, never silently", () => {
    const result = parseResearchOutput('{ "firmographics": { oops');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/malformed JSON/);
  });

  it("EDGE CASE: an empty research result parses but is flagged empty", () => {
    const result = parseResearchOutput("{}");
    expect(result.ok).toBe(true);
    if (result.ok) expect(isEmptyFindings(result.findings)).toBe(true);
  });

  it("collectText concatenates only text blocks, skipping server-tool blocks", () => {
    const text = collectText([
      { type: "server_tool_use" },
      { type: "text", text: "hello" } as { type: string },
      { type: "web_search_tool_result" },
      { type: "text", text: "world" } as { type: string },
    ]);
    expect(text).toBe("hello\nworld");
  });
});

describe("Anthropic request shape (Sonnet 5)", () => {
  const body = buildRequestBody(REQUEST);

  it("runs research on Sonnet 5, not Opus (U6's brief-voice model)", () => {
    expect(body.model).toBe("claude-sonnet-5");
    expect(RESEARCH_MODEL).toBe("claude-sonnet-5");
  });

  it("declares the version-pinned server tools and no code_execution", () => {
    const types = body.tools.map((t) => t.type);
    expect(types).toContain(WEB_SEARCH_TOOL_TYPE);
    expect(types).toContain(WEB_FETCH_TOOL_TYPE);
    expect(types).not.toContain("code_execution_20260120");
  });

  it("sends no sampling parameters (Sonnet 5 rejects them with a 400)", () => {
    const keys = Object.keys(body);
    expect(keys).not.toContain("temperature");
    expect(keys).not.toContain("top_p");
    expect(keys).not.toContain("top_k");
    expect(keys).not.toContain("thinking");
  });
});

describe("usage + cost math", () => {
  it("normalizes server_tool_use counts, defaulting absent fields to 0", () => {
    expect(
      normalizeUsage({ input_tokens: 10, output_tokens: 2 }),
    ).toEqual({
      ...ZERO_USAGE,
      inputTokens: 10,
      outputTokens: 2,
    });
  });

  it("prices tokens + the web-search charge that rides in the same call", () => {
    const usage = {
      ...ZERO_USAGE,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      webSearchRequests: 2,
      webFetchRequests: 5,
    };
    // $3 input + $15 output + 2 x $0.01 search; web fetch is free.
    expect(anthropicCallCostUsd(usage, RESEARCH_RATES)).toBeCloseTo(
      3 + 15 + 2 * WEB_SEARCH_USD_PER_REQUEST,
      10,
    );
  });

  it("prices cache writes at 1.25x and cache reads at 0.1x base input", () => {
    const usage = {
      ...ZERO_USAGE,
      cacheCreationInputTokens: 1_000_000,
      cacheReadInputTokens: 1_000_000,
    };
    expect(anthropicCallCostUsd(usage, RESEARCH_RATES)).toBeCloseTo(3 * 1.25 + 3 * 0.1, 10);
  });
});

describe("metering the research call (R19)", () => {
  it("writes ONE cost_events row carrying the token + search breakdown", async () => {
    const client = FakeResearchClient.fromFixture(researchFixture);
    const { meter, rows } = recordingMeter();

    await runResearch({ client, meter, practiceId: "practice-1" }, REQUEST);

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.provider).toBe("anthropic");
    expect(row.operation).toBe("messages.create");
    expect(row.pipelineStep).toBe("enrich.research");
    expect(row.practiceId).toBe("practice-1");
    expect(row.units).toBe(1);
    expect(row.costUsd).toBeCloseTo(row.unitCostUsd, 12);
    expect(row.costUsd).toBeGreaterThan(0);
    expect(row.meta).toMatchObject({
      model: "claude-sonnet-5",
      inputTokens: 6039,
      outputTokens: 931,
      webSearchRequests: 2,
      webFetchRequests: 3,
      webSearchUsd: 2 * WEB_SEARCH_USD_PER_REQUEST,
    });
  });

  it("ERROR PATH: a malformed body is still a PAID call — it must be metered", async () => {
    const client = FakeResearchClient.malformed();
    const { meter, rows } = recordingMeter();

    const outcome = await runResearch({ client, meter }, REQUEST);

    expect(outcome.ok).toBe(false);
    expect(rows).toHaveLength(1);
    expect(rows[0].costUsd).toBeGreaterThan(0);
  });

  it("ERROR PATH: a network/HTTP failure is UNBILLED, so nothing is metered", async () => {
    const client = FakeResearchClient.throwing(
      new AnthropicRequestError(529, "overloaded"),
    );
    const { meter, rows } = recordingMeter();

    await expect(runResearch({ client, meter }, REQUEST)).rejects.toThrow(
      /529/,
    );
    expect(rows).toHaveLength(0);
  });

  it("ERROR PATH: a request timeout propagates and records no cost", async () => {
    const timeout = new DOMException("The operation timed out.", "TimeoutError");
    const client = FakeResearchClient.throwing(timeout);
    const { meter, rows } = recordingMeter();

    await expect(runResearch({ client, meter }, REQUEST)).rejects.toThrow(
      /timed out/,
    );
    expect(rows).toHaveLength(0);
  });
});

/**
 * The real HTTP client, over a stubbed `fetch`. These drive the boundary the meter wraps,
 * because that is where the money is: a 200 is BILLED whatever its body then does, so
 * nothing past that line may throw.
 *
 * The client now STREAMS (KTD-8). Un-streamed, an agentic request writes no headers until
 * all 16 server-side tool calls finish, and undici aborts it at `headersTimeout = 300e3`
 * — billed, unrecorded, $0.00 on the ledger. These tests pin the salvage ladder.
 */
function sse(...frames: Array<Record<string, unknown>>): string {
  return frames.map((f) => `event: ${String(f.type)}\ndata: ${JSON.stringify(f)}\n\n`).join("");
}

const MESSAGE_START = {
  type: "message_start",
  message: {
    model: RESEARCH_MODEL,
    usage: { input_tokens: 1000, output_tokens: 1, server_tool_use: { web_search_requests: 2 } },
  },
};
const TEXT_DELTA = (text: string) => ({
  type: "content_block_delta",
  index: 0,
  delta: { type: "text_delta", text },
});
const MESSAGE_DELTA = {
  type: "message_delta",
  delta: { stop_reason: "end_turn" },
  usage: { output_tokens: 500 },
};

describe("a BILLED Anthropic 200 always writes a cost row (R19)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Stream `body`, then (optionally) kill the socket instead of closing it cleanly.
   *
   * The bytes are enqueued from `pull`, not `start`. `controller.error()` DISCARDS the
   * queue, so erroring in `start` after an `enqueue` delivers nothing at all — which is
   * not what a dying socket does, and would quietly turn the mid-body test into the
   * before-any-event test.
   */
  function stubStream(body: string, dieAfter = false, status = 200): void {
    vi.stubGlobal("fetch", async () => {
      let sent = false;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!sent && body.length > 0) {
            sent = true;
            controller.enqueue(new TextEncoder().encode(body));
            return;
          }
          if (dieAfter) controller.error(new Error("socket hang up"));
          else controller.close();
        },
      });
      return new Response(stream, { status, headers: { "content-type": "text/event-stream" } });
    });
  }

  const client = () => anthropicResearchClient("test-key-not-a-real-secret");

  it("accumulates input tokens from `message_start` and output tokens from `message_delta`", async () => {
    stubStream(sse(MESSAGE_START, TEXT_DELTA('{"ehr":null}'), MESSAGE_DELTA));
    const { meter, rows } = recordingMeter();

    await runResearch({ client: client(), meter }, REQUEST);

    expect(rows).toHaveLength(1);
    // 1000 in, 500 out (message_delta REPLACES message_start's provisional 1), 2 searches.
    expect(rows[0].meta).toMatchObject({ inputTokens: 1000, outputTokens: 500, webSearchRequests: 2 });
    expect(rows[0].costUsd).toBeCloseTo(
      1000 * ANTHROPIC_INPUT_USD_PER_TOKEN +
        500 * ANTHROPIC_OUTPUT_USD_PER_TOKEN +
        2 * WEB_SEARCH_USD_PER_REQUEST,
      10,
    );
    expect(rows[0].meta).not.toHaveProperty("unpriced");
  });

  it("a stream that dies MID-BODY is priced from the tokens seen, NOT $0.00", async () => {
    // This is the exact failure that cost the ledger $1.27 per killed call. The 200 is the
    // billing event; a socket death afterwards is an incident, not a refund.
    stubStream(sse(MESSAGE_START, TEXT_DELTA('{"firmog')), true);
    const { meter, rows } = recordingMeter();

    const outcome = await runResearch({ client: client(), meter }, REQUEST);

    expect(outcome.ok).toBe(false); // truncated JSON
    expect(rows).toHaveLength(1);
    expect(rows[0].costUsd).toBeGreaterThan(0);
    expect(rows[0].meta).toMatchObject({ inputTokens: 1000 });
    expect(rows[0].meta).not.toHaveProperty("unpriced");
    // The incident rides along on a PRICED row.
    expect(rows[0].meta).toMatchObject({ streamError: expect.stringContaining("socket hang up") });
  });

  it("a stream that dies BEFORE any event writes an UNPRICED row naming the fault", async () => {
    stubStream("", true);
    const { meter, rows } = recordingMeter();

    const outcome = await runResearch({ client: client(), meter }, REQUEST);

    expect(outcome.ok).toBe(false);
    expect(rows).toHaveLength(1);
    expect(rows[0].units).toBe(1);
    expect(rows[0].costUsd).toBe(0);
    expect(rows[0].meta).toMatchObject({ unpriced: true, reason: expect.stringContaining("socket hang up") });
  });

  it("captures `err.cause.code` — the diagnosis, not `fetch failed`", async () => {
    // Node wraps the real fault: the outer error is always `TypeError: fetch failed`, and
    // `UND_ERR_HEADERS_TIMEOUT` lives on `err.cause.code`. Logging only the outer message
    // is how a 300s ceiling was misread for months as "Anthropic is slow."
    const wrapped = new TypeError("fetch failed", {
      cause: Object.assign(new Error("Headers Timeout Error"), { code: "UND_ERR_HEADERS_TIMEOUT" }),
    });
    vi.stubGlobal("fetch", async () => {
      const stream = new ReadableStream<Uint8Array>({
        start: (controller) => controller.error(wrapped),
      });
      return new Response(stream, { status: 200 });
    });
    const { meter, rows } = recordingMeter();

    await runResearch({ client: client(), meter }, REQUEST);

    expect(rows[0].meta).toMatchObject({
      unpriced: true,
      reason: expect.stringContaining("UND_ERR_HEADERS_TIMEOUT"),
    });
  });

  it("a 200 that streams nothing at all is UNPRICED with `empty-stream`", async () => {
    // An edge/proxy handed back a 200 with an unrecognizable body. Anthropic billed it.
    stubStream("<html><body>200 OK</body></html>");
    const { meter, rows } = recordingMeter();

    const outcome = await runResearch({ client: client(), meter }, REQUEST);

    expect(outcome.ok).toBe(false);
    expect(rows).toHaveLength(1);
    expect(rows[0].units).toBe(1);
    expect(rows[0].costUsd).toBe(0);
    expect(rows[0].meta).toMatchObject({ unpriced: true, reason: EMPTY_STREAM });
  });

  it("a mid-stream `error` event on a 200 is priced and reported, never thrown", async () => {
    stubStream(sse(MESSAGE_START, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }));
    const { meter, rows } = recordingMeter();

    await runResearch({ client: client(), meter }, REQUEST);

    expect(rows[0].costUsd).toBeGreaterThan(0);
    expect(rows[0].meta).toMatchObject({ streamError: "Overloaded" });
  });

  it("ERROR PATH: a 500 is UNBILLED — it throws before the stream opens, and writes NO cost row", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
    const { meter, rows } = recordingMeter();

    await expect(
      runResearch({ client: client(), meter }, REQUEST),
    ).rejects.toThrow(AnthropicRequestError);
    expect(rows).toHaveLength(0);
  });
});
