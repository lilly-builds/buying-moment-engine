import { parseMessagesResponse, readJsonBody } from "@/src/enrich/anthropic-client";
import {
  ANTHROPIC_API_URL,
  ANTHROPIC_API_VERSION,
  anthropicCallCostUsd,
  anthropicCostBreakdown,
} from "@/src/enrich/config";
import { AnthropicRequestError, type ClaudeUsage, type ResearchResponse } from "@/src/enrich/types";
import type { Meter } from "@/src/roi/cost-meter";
import {
  PIPELINE_STEP_BRIEF,
  VOICE_EFFORT,
  VOICE_FETCH_TIMEOUT_MS,
  VOICE_MAX_TOKENS,
  VOICE_MODEL,
  VOICE_RATES,
} from "./config";
import { buildVoicePrompt, VOICE_JSON_SCHEMA, VOICE_SYSTEM_PROMPT, type VoiceRequest } from "./prompts/voice";
import { parseVoiceOutput, type VoiceBrief } from "./schema";

/**
 * Stage 2 of the brief (U6): ONE Opus 4.8 call that writes prose over evidence we already
 * hold and have already proved.
 *
 * The model gets no tools, no web access, and no facts beyond the EVIDENCE block. It is
 * not researching; it is writing. That is the whole reason this call can be a single
 * plain Messages request while `src/enrich/` needed a scrape rail, a citation verifier,
 * and an escalation budget to get to the same place.
 *
 * R19: wrapped in `meter`, one `cost_events` row per HTTP request, priced from the
 * response's own `usage` against `VOICE_RATES`. A retry is a second billed call and gets
 * a second row — `meta.attempt` tells the scoreboard which briefs cost twice, and why.
 *
 * PARSING HAPPENS OUTSIDE THE METER, exactly as `src/enrich/extract.ts` documents. A
 * billed 200 whose body we cannot read still cost money. Parsing inside `fn` would throw,
 * the meter would record nothing, and measured CAC would understate spend precisely on
 * the calls that went wrong. This repo has already paid for that lesson once — the
 * `westlake-dermatology` row that reported $0.00 for a call Anthropic billed at ~$1.27.
 */

/** The seam. Production binds `anthropicVoiceClient`; tests inject a fixture. */
export interface VoiceClient {
  generate(request: VoiceRequest): Promise<ResearchResponse>;
}

export interface VoiceDeps {
  client: VoiceClient;
  meter: Meter;
  practiceId?: string | null;
}

export type VoiceOutcome =
  | { ok: true; voice: VoiceBrief; usage: ClaudeUsage; model: string }
  | { ok: false; reason: string; usage: ClaudeUsage; model: string };

/**
 * One attempt. `attempt` is 1-indexed and lands in the cost row's `meta` so a cohort run
 * can measure the retry rate — the observable that says whether the prompt and the lint
 * actually agree with each other.
 */
export async function runVoice(
  deps: VoiceDeps,
  request: VoiceRequest,
  attempt = 1,
): Promise<VoiceOutcome> {
  const response = await deps.meter(
    {
      provider: "anthropic",
      operation: "messages.create",
      pipelineStep: PIPELINE_STEP_BRIEF,
      practiceId: deps.practiceId ?? null,
      units: 1,
      unitCostUsd: (res) => anthropicCallCostUsd(res.usage, VOICE_RATES),
      meta: (res) => ({
        ...anthropicCostBreakdown(res.usage, VOICE_RATES),
        practiceName: request.practice.name,
        vertical: request.practice.vertical,
        zeroSignal: request.zeroSignal,
        signalsShown: request.signals.length,
        factsShown: request.facts.length,
        attempt,
        ...(res.unpricedReason === undefined
          ? {}
          : { unpriced: true, reason: res.unpricedReason }),
      }),
    },
    () => deps.client.generate(request),
  );

  // Structured outputs return bare JSON. `parseVoiceOutput` still runs `JSON.parse` first
  // so a `stop_reason: "max_tokens"` truncation reports its real syntax error rather than
  // a vague schema complaint. The API guarantees SHAPE; only zod, and then `lint.ts`,
  // speak to size and to truth.
  const parsed = parseVoiceOutput(response.text);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason, usage: response.usage, model: response.model };
  }
  return { ok: true, voice: parsed.voice, usage: response.usage, model: response.model };
}

/**
 * The request body. Every field here is a decision, and three of them are 400s if wrong
 * (verified against the Opus 4.8 docs, not recalled — see `config.ts`):
 *
 *  - NO `temperature` / `top_p` / `top_k`. Removed on this model; sending one is a 400.
 *    Voice is steered entirely by `VOICE_SYSTEM_PROMPT`, which is the honest place for it.
 *  - `thinking: {type: "adaptive"}` is set EXPLICITLY. Omitting the field runs the model
 *    with no thinking at all on Opus 4.8 — a silent quality regression, not an error. The
 *    schema makes the model attach an evidence id to every claim while obeying a banned-
 *    phrase list and nine length caps; that is what adaptive thinking is for.
 *  - `effort` lives INSIDE `output_config`, alongside `format`. Top-level is a 400.
 *
 * No prompt caching. Opus 4.8's minimum cacheable prefix is 4,096 tokens and this system
 * prompt is shorter, so a `cache_control` block would silently no-op while implying a
 * saving that never lands in `cost_events`. Same reasoning as `extract.ts` on Haiku.
 *
 * Non-streaming: `VOICE_MAX_TOKENS` is 16k, at the SDK's guidance ceiling for a
 * non-streamed request. Thinking is billed inside that budget, so the ceiling covers both.
 */
export function buildVoiceRequestBody(request: VoiceRequest) {
  return {
    model: VOICE_MODEL,
    max_tokens: VOICE_MAX_TOKENS,
    system: VOICE_SYSTEM_PROMPT,
    thinking: { type: "adaptive" as const },
    messages: [{ role: "user", content: buildVoicePrompt(request) }],
    output_config: {
      effort: VOICE_EFFORT,
      format: { type: "json_schema", schema: VOICE_JSON_SCHEMA },
    },
  };
}

/**
 * Production binding. `apiKey` is injected, never read from module scope.
 *
 * Raw `fetch`, not the Anthropic SDK, and deliberately — the SDK throws on a non-2xx and
 * on a body it cannot decode. A billed 200 must RESOLVE so the meter writes its row. This
 * also matches `anthropic-client.ts`, `extract.ts` and `pdl-client.ts`, so there is one
 * HTTP idiom in the repo rather than two.
 *
 * `parseMessagesResponse` is reused as-is: it concatenates the top-level `text` blocks and
 * ignores the `thinking` blocks adaptive thinking emits, whose text is empty by default on
 * this model anyway (`display: "omitted"`).
 */
export function anthropicVoiceClient(apiKey: string): VoiceClient {
  return {
    async generate(request: VoiceRequest): Promise<ResearchResponse> {
      const res = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_API_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify(buildVoiceRequestBody(request)),
        signal: AbortSignal.timeout(VOICE_FETCH_TIMEOUT_MS),
      });
      // Non-2xx is an UNBILLED call: throw, and the meter correctly records nothing.
      // Past this line the request is billed, so nothing may throw.
      if (!res.ok) throw new AnthropicRequestError(res.status, res.statusText);
      return parseMessagesResponse(await readJsonBody(res), VOICE_MODEL);
    },
  };
}
