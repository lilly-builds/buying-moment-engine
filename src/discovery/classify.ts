import type { Meter } from "@/src/roi/cost-meter";
import { parseMessagesResponse, readJsonBody } from "@/src/enrich/anthropic-client";
import {
  ANTHROPIC_API_URL,
  ANTHROPIC_API_VERSION,
  anthropicCallCostUsd,
  anthropicCostBreakdown,
} from "@/src/enrich/config";
import {
  AnthropicRequestError,
  type ClaudeUsage,
  type ResearchResponse,
} from "@/src/enrich/types";
import {
  CLASSIFY_FETCH_TIMEOUT_MS,
  CLASSIFY_MAX_TOKENS,
  CLASSIFY_MODEL,
  CLASSIFY_RATES,
  PIPELINE_STEP_CLASSIFY,
} from "./config";
import {
  buildClassifyPrompt,
  CLASSIFY_JSON_SCHEMA,
  CLASSIFY_SYSTEM_PROMPT,
} from "./classify-prompt";
import { parseClassifyOutput, type ClassifyOutput } from "./classify-schema";

/**
 * The per-tenant review qualifier (U3) — the swappable analysis step. ONE Haiku 4.5
 * call turns (tenant criterion + one review) into a `{ qualifies, confidence,
 * category }` verdict. This is the deliberate replacement for the keyword
 * `classifyPhoneComplaint` matcher: an LLM generalises across tenants where a fixed
 * vocabulary cannot (user decision), at the cost of a stricter precision guard in
 * the prompt.
 *
 * It mirrors `src/enrich/extract.ts` end-to-end (K3), and for the same reasons:
 *  - the paid call is wrapped in `meter` — one `cost_events` row per HTTP request,
 *    priced from the response's own `usage` at the Haiku rate card.
 *  - PARSING HAPPENS OUTSIDE THE METER. A billed 200 whose body we cannot parse
 *    still cost money; parsing inside `fn` would throw, the meter would record
 *    nothing, and measured CAC would understate spend on exactly the calls that
 *    went wrong. That is the failure this repo already paid for once.
 *  - the client is an INTERFACE, injected — tests run a recorded fixture through the
 *    SAME `parseMessagesResponse` production uses, with zero paid calls.
 *
 * Google ToS (R5/K4): the review text is sent to Anthropic TRANSIENTLY, in-memory,
 * at classify time. Nothing here persists or logs it — the verdict carries only our
 * derived category, and `meta` deliberately holds no review-derived field.
 */

/** One review to judge against one tenant's criterion. Neither is ever persisted. */
export interface ClassifyRequest {
  /** The tenant's swappable qualification prompt — what a qualifying review looks like. */
  qualificationPrompt: string;
  /** ONE review's text. Sent to classify transiently; never stored or logged (R5). */
  reviewText: string;
}

/**
 * Same raw shape as the enrich clients: text + usage + model, parsed outside the
 * meter. A billed 200 whose body we cannot read is a resolved response carrying
 * `unpricedReason`, never a throw.
 */
export interface ClassifyClient {
  classify(request: ClassifyRequest): Promise<ResearchResponse>;
}

export interface ClassifyDeps {
  client: ClassifyClient;
  meter: Meter;
  /** Null during discovery: the qualifier runs BEFORE a practice exists (R6). */
  practiceId?: string | null;
}

export type ClassifyOutcome =
  | { ok: true; result: ClassifyOutput; usage: ClaudeUsage; model: string }
  | { ok: false; reason: string; usage: ClaudeUsage; model: string };

export async function runClassify(
  deps: ClassifyDeps,
  request: ClassifyRequest,
): Promise<ClassifyOutcome> {
  const response = await deps.meter(
    {
      provider: "anthropic",
      operation: "messages.create",
      pipelineStep: PIPELINE_STEP_CLASSIFY,
      // Discovery qualifies reviews BEFORE resolving a practice, so cost rows on
      // this step are practice-unattributed by design (R6).
      practiceId: deps.practiceId ?? null,
      units: 1,
      unitCostUsd: (res) => anthropicCallCostUsd(res.usage, CLASSIFY_RATES),
      // R5: NOTHING review-derived goes in meta — only the priced-token breakdown.
      meta: (res) => ({
        ...anthropicCostBreakdown(res.usage, CLASSIFY_RATES),
        ...(res.unpricedReason === undefined
          ? {}
          : { unpriced: true, reason: res.unpricedReason }),
      }),
    },
    () => deps.client.classify(request),
  );

  const parsed = parseClassifyOutput(response.text);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason, usage: response.usage, model: response.model };
  }
  return { ok: true, result: parsed.result, usage: response.usage, model: response.model };
}

/**
 * The request body. No `thinking`/`effort`/sampling params and no `cache_control`,
 * for the same reasons the extract path documents: Haiku has no thinking, errors on
 * `effort`, rejects sampling params, and its 4,096-token minimum cacheable prefix
 * makes a `cache_control` block a silent no-op. `output_config.format` is the
 * canonical structured-output parameter.
 */
export function buildClassifyRequestBody(request: ClassifyRequest) {
  return {
    model: CLASSIFY_MODEL,
    max_tokens: CLASSIFY_MAX_TOKENS,
    system: CLASSIFY_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: buildClassifyPrompt(request.qualificationPrompt, request.reviewText),
      },
    ],
    output_config: {
      format: { type: "json_schema", schema: CLASSIFY_JSON_SCHEMA },
    },
  };
}

/**
 * Production binding. `apiKey` is injected, never read from module scope. Raw
 * `fetch`, not the SDK: a billed 200 must RESOLVE so the meter writes its row, and
 * the SDK throws on a non-2xx and on an undecodable body. Matches
 * `anthropicExtractClient`.
 */
export function anthropicClassifyClient(apiKey: string): ClassifyClient {
  return {
    async classify(request: ClassifyRequest): Promise<ResearchResponse> {
      const res = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_API_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify(buildClassifyRequestBody(request)),
        signal: AbortSignal.timeout(CLASSIFY_FETCH_TIMEOUT_MS),
      });
      // Non-2xx is an UNBILLED call: throw, and the meter records nothing. Past this
      // line the request is billed, so nothing may throw.
      if (!res.ok) throw new AnthropicRequestError(res.status, res.statusText);
      return parseMessagesResponse(await readJsonBody(res), CLASSIFY_MODEL);
    },
  };
}
