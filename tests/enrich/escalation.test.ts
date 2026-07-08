import { describe, expect, it } from "vitest";
import researchFixture from "./fixtures/anthropic-research-response.json";
import { FakeResearchClient, recordingMeter } from "./doubles";
import { parseMessagesResponse } from "@/src/enrich/anthropic-client";
import {
  consumeSseStream,
  describeFailure,
  extractSseData,
  StreamAccumulator,
} from "@/src/enrich/anthropic-stream";
import {
  createEscalationBudget,
  noEscalationBudget,
  runEscalation,
} from "@/src/enrich/escalation";
import { AnthropicRequestError } from "@/src/enrich/types";

/**
 * The agentic fallback: what stops it, what fires it, and what it costs when it lies.
 * Zero paid calls — every Anthropic response here is a recorded fixture.
 */

const REQUEST = {
  practiceName: "Sunshine Dermatology Associates",
  city: "Miami",
  state: "FL",
  websiteUrl: "https://sunshinederm.example",
};

describe("EscalationBudget — triggering is free, firing is $1.27", () => {
  it("allows exactly `max` escalations across a run, then refuses", () => {
    const budget = createEscalationBudget(2);
    expect([budget.take(), budget.take(), budget.take()]).toEqual([true, true, false]);
    expect(budget.spent).toBe(2);
    expect(budget.max).toBe(2);
  });

  it("a ZERO budget refuses immediately — U8's setting, so a trigger costs nothing", () => {
    const budget = noEscalationBudget();
    expect(budget.take()).toBe(false);
    expect(budget.spent).toBe(0);
  });

  it("a spent budget makes NO call — the client is never touched", async () => {
    const client = FakeResearchClient.fromFixture(researchFixture);
    const { meter, rows } = recordingMeter();

    const outcome = await runEscalation(
      { client, meter, budget: noEscalationBudget() },
      REQUEST,
    );

    expect(outcome).toEqual({ attempted: false });
    expect(client.calls).toEqual([]);
    expect(rows).toEqual([]); // no money left the account
  });
});

describe("runEscalation — it reads the live web, so our cleaned text cannot judge it", () => {
  it("EVERY fact comes back unverifiable, and NONE is called a lie", async () => {
    // Escalation exists because the free path could not read this practice. The agentic
    // model `web_fetch`ed the live pages; we hold, at best, a pruned and reordered copy.
    // We cannot prove its facts. We also cannot refute them. Both statements are honest.
    const { meter, rows } = recordingMeter();
    const outcome = await runEscalation(
      { client: FakeResearchClient.fromFixture(researchFixture), meter, budget: createEscalationBudget(1) },
      REQUEST,
    );

    expect(outcome.attempted).toBe(true);
    if (!outcome.attempted || !outcome.ok) throw new Error("expected an ok escalation");

    expect(outcome.unverifiable.length).toBeGreaterThan(0);
    expect(outcome.unverifiable.every((f) => f.reason === "url-not-held")).toBe(true);
    expect(outcome.findings.ehr?.value).toBe("ModMed EMA");
    expect(outcome.billed).toBe(true);
    expect(rows).toHaveLength(1); // one paid agentic call, metered
  });

  it("REGRESSION: a TRUE snippet that `cleanHtml` pruned is not dropped as fabrication", async () => {
    // The bug this guards: verifying Sonnet's live-page snippets against our cleaned copy.
    // `cleanHtml` deletes nav/header/footer, drops paragraphs under 20 chars, and emits all
    // headings BEFORE all prose — so a span the model copied verbatim off the real page can
    // be absent from ours. Dropping it would destroy a true fact, on the $1.27 path, and
    // file it under `enrich.citation_drops` — the prompt-drift alarm.
    const base = parseMessagesResponse(researchFixture);
    const fromLivePage = new FakeResearchClient(async () => ({
      ...base,
      // A short `<li>ModMed EMA</li>`: real on the live page, pruned from our copy.
      text: base.text.replace("Our patient portal is powered by ModMed EMA.", "ModMed EMA"),
    }));
    const { meter } = recordingMeter();

    const outcome = await runEscalation(
      { client: fromLivePage, meter, budget: createEscalationBudget(1) },
      REQUEST,
    );

    if (!outcome.attempted || !outcome.ok) throw new Error("expected an ok escalation");
    expect(outcome.findings.ehr?.value).toBe("ModMed EMA"); // kept
    expect(outcome.unverifiable.map((f) => f.field)).toContain("ehr"); // and flagged
  });

  it("paid $1.27 and the model returned nothing -> a recorded failure, never a partial write", async () => {
    const base = parseMessagesResponse(researchFixture);
    const empty = new FakeResearchClient(async () => ({ ...base, text: "{}" }));
    const { meter, rows } = recordingMeter();

    const outcome = await runEscalation(
      { client: empty, meter, budget: createEscalationBudget(1) },
      REQUEST,
    );

    expect(outcome).toMatchObject({ attempted: true, ok: false, billed: true });
    if (outcome.attempted && !outcome.ok) expect(outcome.reason).toMatch(/no usable facts/);
    expect(rows).toHaveLength(1); // the money is on the ledger regardless
  });

  it("a THROWN escalation is UNBILLED — and must never report as $1.27 spent", async () => {
    // The inverse of the Westlake bug: free recorded as paid. The budget is still consumed,
    // so the cap can only ever authorize LESS spend than `max`, never more.
    const budget = createEscalationBudget(1);
    const { meter, rows } = recordingMeter();

    const outcome = await runEscalation(
      { client: FakeResearchClient.throwing(new AnthropicRequestError(429, "rate limited")), meter, budget },
      REQUEST,
    );

    expect(outcome).toMatchObject({ attempted: true, ok: false, billed: false });
    expect(rows).toEqual([]); // the meter wrote nothing, correctly
    expect(budget.take()).toBe(false); // and the attempt is still counted
  });

  it("a malformed escalation body IS billed, and says so", async () => {
    const { meter, rows } = recordingMeter();
    const outcome = await runEscalation(
      { client: FakeResearchClient.malformed(), meter, budget: createEscalationBudget(1) },
      REQUEST,
    );

    expect(outcome).toMatchObject({ attempted: true, ok: false, billed: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].costUsd).toBeGreaterThan(0);
  });
});

describe("extractSseData — a frame torn across a TCP boundary is never parsed as whole", () => {
  it("returns complete frames and holds the partial one back", () => {
    const { payloads, rest } = extractSseData(
      'event: a\ndata: {"n":1}\n\nevent: b\ndata: {"n":2}\n\nevent: c\ndata: {"n":3',
    );
    expect(payloads).toEqual(['{"n":1}', '{"n":2}']);
    expect(rest).toBe('event: c\ndata: {"n":3');
  });

  it("joins a multi-line `data:` payload", () => {
    const { payloads } = extractSseData('event: a\ndata: {"n":\ndata: 1}\n\n');
    expect(payloads).toEqual(['{"n":1}']);
  });

  it("ignores frames with no data line (ping, comments)", () => {
    expect(extractSseData("event: ping\n\n: keep-alive\n\n").payloads).toEqual([]);
  });
});

describe("StreamAccumulator — a dying stream still knows what it cost", () => {
  it("takes input tokens from message_start and lets message_delta REPLACE output", () => {
    const acc = new StreamAccumulator();
    acc.apply({
      type: "message_start",
      message: {
        model: "claude-sonnet-5",
        usage: { input_tokens: 9000, output_tokens: 1, cache_read_input_tokens: 40 },
      },
    });
    acc.apply({ type: "content_block_delta", delta: { type: "text_delta", text: "he" } });
    acc.apply({ type: "content_block_delta", delta: { type: "text_delta", text: "llo" } });
    acc.apply({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 512 } });

    expect(acc.text).toBe("hello");
    expect(acc.model).toBe("claude-sonnet-5");
    expect(acc.stopReason).toBe("end_turn");
    expect(acc.usage).toMatchObject({ inputTokens: 9000, outputTokens: 512, cacheReadInputTokens: 40 });
  });

  it("prices a stream that stopped after message_start — the whole point of accumulating", () => {
    const acc = new StreamAccumulator();
    acc.apply({ type: "message_start", message: { usage: { input_tokens: 9000 } } });
    expect(acc.sawAnyEvent).toBe(true);
    expect(acc.usage.inputTokens).toBe(9000);
  });

  it("ignores non-text deltas — tool args are not the answer", () => {
    const acc = new StreamAccumulator();
    acc.apply({ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: '{"q":' } });
    expect(acc.text).toBe("");
  });

  it("COUNTS a complete-but-unparseable frame rather than swallowing it", async () => {
    const acc = new StreamAccumulator();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("event: x\ndata: not json\n\n"));
        controller.close();
      },
    });
    await consumeSseStream(stream, acc);
    expect(acc.malformedFrames).toBe(1);
    expect(acc.sawAnyEvent).toBe(false);
  });

  it("captures Anthropic's mid-stream `error` event", () => {
    const acc = new StreamAccumulator();
    acc.apply({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } });
    expect(acc.apiError).toBe("Overloaded");
  });
});

describe("describeFailure — the diagnosis, not the symptom", () => {
  it("digs `err.cause.code` out from under `TypeError: fetch failed`", () => {
    const err = new TypeError("fetch failed", {
      cause: Object.assign(new Error("Headers Timeout Error"), { code: "UND_ERR_HEADERS_TIMEOUT" }),
    });
    expect(describeFailure(err)).toBe(
      "TypeError: fetch failed (cause: UND_ERR_HEADERS_TIMEOUT)",
    );
  });

  it("degrades to the plain message when there is no cause code", () => {
    expect(describeFailure(new Error("socket hang up"))).toBe("Error: socket hang up");
  });
});
