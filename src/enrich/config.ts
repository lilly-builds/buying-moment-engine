/**
 * Enrichment configuration — every price is a NAMED constant with the source it
 * came from. No magic number ever appears at a call site; CAC is a measured
 * number (R19/D10) and a measured number has to be auditable back to a published
 * rate card.
 *
 * Verified 2026-07-08 against Anthropic + PDL published docs (URLs inline).
 */

import type { ClaudeUsage } from "./types";

// ─── Models (spec § Stack — LOCKED) ───────────────────────────────────────────
//
// "Anthropic Claude — Opus 4.8 (brief voice) · Sonnet 5 / Haiku 4.5 (agentic
// research + extraction)". Opus 4.8 is U6's brief-voice model, never used here.
//
// EXTRACT is the primary path: one call over page text we already hold, so it needs
// no web tools and no reasoning depth — Haiku 4.5 does it for ~1/128th of the cost
// (E5, n=6). RESEARCH is the rare agentic escalation, which needs `web_search` /
// `web_fetch`; those `_20260209` tools require Sonnet 5 or Opus 4.6+ and are NOT
// available on Haiku, so escalation stays on Sonnet 5.
export const EXTRACT_MODEL = "claude-haiku-4-5" as const;
export const RESEARCH_MODEL = "claude-sonnet-5" as const;

/** Non-streaming; stays well under the SDK/HTTP timeout ceiling (~16k). */
export const RESEARCH_MAX_TOKENS = 8000;

/**
 * Findings JSON for one practice. Measured output was 700-1,100 tokens (E5, n=6);
 * 4k leaves headroom without inviting a `stop_reason: max_tokens` truncation, which
 * under structured outputs yields syntactically incomplete JSON.
 */
export const EXTRACT_MAX_TOKENS = 4000;

// ─── Anthropic pricing (USD per token) ────────────────────────────────────────
//
// https://platform.claude.com/docs/en/about-claude/models/overview
// Claude Sonnet 5 list price: $3 / input MTok, $15 / output MTok.
// NOTE: introductory pricing of $2 / $10 per MTok applies through 2026-08-31.
// We meter at LIST price on purpose: the scoreboard should not quietly bake in a
// promotional rate that expires mid-demo and silently re-prices historical CAC.
export const ANTHROPIC_INPUT_USD_PER_TOKEN = 3 / 1_000_000;
export const ANTHROPIC_OUTPUT_USD_PER_TOKEN = 15 / 1_000_000;

// Claude Haiku 4.5 list price: $1 / input MTok, $5 / output MTok. Same source.
export const HAIKU_INPUT_USD_PER_TOKEN = 1 / 1_000_000;
export const HAIKU_OUTPUT_USD_PER_TOKEN = 5 / 1_000_000;

/**
 * A rate card, passed EXPLICITLY to every pricing call.
 *
 * There is no default. Two models now share one cost formula, and a default would
 * mean forgetting the argument prices a Haiku call at Sonnet rates — silently, by
 * 3x, in the one number (CAC) this repo exists to measure. A missing argument
 * should be a compile error, not a plausible wrong answer.
 */
export interface ModelRates {
  /** The rate card we priced against, written into `meta.model` on the cost row. */
  model: string;
  inputUsdPerToken: number;
  outputUsdPerToken: number;
}

export const RESEARCH_RATES: ModelRates = {
  model: RESEARCH_MODEL,
  inputUsdPerToken: ANTHROPIC_INPUT_USD_PER_TOKEN,
  outputUsdPerToken: ANTHROPIC_OUTPUT_USD_PER_TOKEN,
};

export const EXTRACT_RATES: ModelRates = {
  model: EXTRACT_MODEL,
  inputUsdPerToken: HAIKU_INPUT_USD_PER_TOKEN,
  outputUsdPerToken: HAIKU_OUTPUT_USD_PER_TOKEN,
};

// https://platform.claude.com/docs/en/build-with-claude/prompt-caching
// Cache writes cost 1.25x base input; cache reads cost 0.1x base input.
export const ANTHROPIC_CACHE_WRITE_MULTIPLIER = 1.25;
export const ANTHROPIC_CACHE_READ_MULTIPLIER = 0.1;

// https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
// "Web search is available on the Claude API for $10 per 1,000 searches, plus
// standard token costs." Errored searches are not billed.
export const WEB_SEARCH_USD_PER_REQUEST = 10 / 1_000;

// https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool
// "Web fetch usage has no additional charges beyond standard token costs."
// Kept as an explicit zero so a future price change has one place to land.
export const WEB_FETCH_USD_PER_REQUEST = 0;

// ─── Server tools (type strings are version-pinned, not evergreen) ────────────
//
// `_20260209` adds dynamic filtering and is supported on Sonnet 5. It filters
// results inside code execution before they reach the context window — no extra
// charge beyond tokens, and no need to declare code_execution ourselves.
export const WEB_SEARCH_TOOL_TYPE = "web_search_20260209" as const;
export const WEB_SEARCH_TOOL_NAME = "web_search" as const;
export const WEB_FETCH_TOOL_TYPE = "web_fetch_20260209" as const;
export const WEB_FETCH_TOOL_NAME = "web_fetch" as const;

/** Bounds worst-case spend per practice: 8 searches = $0.08 ceiling on search. */
export const WEB_SEARCH_MAX_USES = 8;
export const WEB_FETCH_MAX_USES = 8;

export const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_API_VERSION = "2023-06-01";

// ─── PDL pricing ──────────────────────────────────────────────────────────────
//
// spec § Stack-validation, experiment #1: "Cost anchors on file: PDL ~$0.28/record
// self-serve (-> cents at Enterprise)". Enrichment bills on a 200 match; Person
// Search bills per record returned in `data`, so the search client caps `size`.
export const PDL_USD_PER_MATCHED_RECORD = 0.28;

export const PDL_PERSON_ENRICH_URL =
  "https://api.peopledatalabs.com/v5/person/enrich";
export const PDL_PERSON_SEARCH_URL =
  "https://api.peopledatalabs.com/v5/person/search";
export const PDL_COMPANY_ENRICH_URL =
  "https://api.peopledatalabs.com/v5/company/enrich";

/**
 * PDL returns a `likelihood` of 1-10 on person enrichment. Below 6 the match is
 * a guess; a guessed work email sent to a real practice is exactly the failure
 * D9 forbids, so we treat a low-likelihood match as NO match and degrade to the
 * role-only variant. https://docs.peopledatalabs.com/docs/reference-person-enrichment-api
 */
export const PDL_MIN_LIKELIHOOD = 6;

/**
 * Person Search does not return PDL's 1-10 enrichment likelihood. We score the
 * returned profile deterministically from exact-company, target-title, location, and
 * business-contact evidence. Below this line, the contact stays role-only/none.
 */
export const PDL_MIN_DISCOVERY_CONFIDENCE = 0.7;

/** Cap Person Search spend: PDL bills per record returned; five profiles lets us score past a weak first result without opening an unbounded bill. */
export const PDL_PERSON_DISCOVERY_SIZE = 5;

// ─── Shared ───────────────────────────────────────────────────────────────────

/**
 * A TOTAL-DURATION guard on the agentic escalation call, and nothing more.
 *
 * It is no longer the thing that kills the call. Agentic research runs up to
 * WEB_SEARCH_MAX_USES searches + WEB_FETCH_MAX_USES fetches SERVER-SIDE before writing a
 * byte, and un-streamed that tripped undici's `headersTimeout`
 * (`undici@7.28.0 lib/dispatcher/client.js:262` = `300e3`) — a first-byte-of-headers
 * ceiling, not a duration one. It killed 1 call in 3 while recording $0.00. The call now
 * STREAMS (see `anthropic-stream.ts`), headers land immediately, and that ceiling cannot
 * fire. What remains is `bodyTimeout` (`:261`, also `300e3`), the gap BETWEEN chunks,
 * which Anthropic's periodic `ping` events reset.
 *
 * So this abort signal now means what it says: a call still running after ten minutes is
 * a call to give up on.
 */
export const ENRICH_FETCH_TIMEOUT_MS = 600_000;
export const PDL_FETCH_TIMEOUT_MS = 20_000;

/**
 * How many practices in ONE cohort run may buy the agentic fallback.
 *
 * Escalation costs $1.27 a shot. `escalationTrigger` (free, deterministic) and
 * `escalated` (paid) are separate on purpose: a cap of 3 quietly authorizes $3.81, which
 * is 38x the ~$0.10 a whole 5-practice verification run is meant to cost. U8 sets this to
 * ZERO and simply records how often escalation WOULD have fired — measuring the rate
 * before paying to learn it.
 */
export const MAX_ESCALATIONS_PER_RUN = 3;

/**
 * Extraction is a PLAIN Messages call over text we already hold — no server-side
 * browsing, so it is bounded by Anthropic, not by the web. Measured wall time was
 * seconds (E5). It must never inherit the agentic path's 10-minute ceiling; a
 * 60s abort here is a real signal that something is wrong.
 */
export const EXTRACT_FETCH_TIMEOUT_MS = 60_000;

/** `cost_events.pipeline_step` values — the scoreboard slices spend on these. */
export const PIPELINE_STEP_RESEARCH = "enrich.research";
export const PIPELINE_STEP_EXTRACT = "enrich.extract";
export const PIPELINE_STEP_PDL = "enrich.pdl";

/** The server-tool surcharge riding inside a Messages call. Zero on the extract path. */
function serverToolUsd(usage: ClaudeUsage): number {
  return (
    usage.webSearchRequests * WEB_SEARCH_USD_PER_REQUEST +
    usage.webFetchRequests * WEB_FETCH_USD_PER_REQUEST
  );
}

/**
 * Total USD for ONE Anthropic Messages request: tokens (input, output, cache
 * write, cache read) plus the server-side web-search charge that rides inside the
 * same HTTP call. Web fetch adds nothing beyond tokens.
 *
 * One paid HTTP call -> one `cost_events` row (see `db/schema/roi.ts`), with the
 * component breakdown carried in `meta` so U12 can split token spend from
 * search spend without a second, synthetic wrapper.
 *
 * Cache multipliers are model-independent (1.25x write, 0.1x read) and apply to
 * whichever base input rate `rates` carries.
 */
export function anthropicCallCostUsd(
  usage: ClaudeUsage,
  rates: ModelRates,
): number {
  const input = usage.inputTokens * rates.inputUsdPerToken;
  const output = usage.outputTokens * rates.outputUsdPerToken;
  const cacheWrite =
    usage.cacheCreationInputTokens *
    rates.inputUsdPerToken *
    ANTHROPIC_CACHE_WRITE_MULTIPLIER;
  const cacheRead =
    usage.cacheReadInputTokens *
    rates.inputUsdPerToken *
    ANTHROPIC_CACHE_READ_MULTIPLIER;
  return input + output + cacheWrite + cacheRead + serverToolUsd(usage);
}

/** The `meta` breakdown written alongside each Anthropic cost_events row. */
export function anthropicCostBreakdown(
  usage: ClaudeUsage,
  rates: ModelRates,
): Record<string, unknown> {
  return {
    model: rates.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    webSearchRequests: usage.webSearchRequests,
    webFetchRequests: usage.webFetchRequests,
    webSearchUsd: usage.webSearchRequests * WEB_SEARCH_USD_PER_REQUEST,
    tokenUsd: anthropicCallCostUsd(usage, rates) - serverToolUsd(usage),
  };
}
