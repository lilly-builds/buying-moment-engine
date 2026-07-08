/**
 * Enrichment configuration — every price is a NAMED constant with the source it
 * came from. No magic number ever appears at a call site; CAC is a measured
 * number (R19/D10) and a measured number has to be auditable back to a published
 * rate card.
 *
 * Verified 2026-07-08 against Anthropic + PDL published docs (URLs inline).
 */

import type { ClaudeUsage } from "./types";

// ─── Model (spec § Stack — LOCKED) ────────────────────────────────────────────
//
// "Anthropic Claude — Opus 4.8 (brief voice) · Sonnet 5 / Haiku 4.5 (agentic
// research + extraction)". U5 is research + extraction, so it runs on Sonnet 5.
// Opus 4.8 is U6's brief-voice model and is deliberately NOT used here.
export const RESEARCH_MODEL = "claude-sonnet-5" as const;

/** Non-streaming; stays well under the SDK/HTTP timeout ceiling (~16k). */
export const RESEARCH_MAX_TOKENS = 8000;

// ─── Anthropic pricing (USD per token) ────────────────────────────────────────
//
// https://platform.claude.com/docs/en/about-claude/models/overview
// Claude Sonnet 5 list price: $3 / input MTok, $15 / output MTok.
// NOTE: introductory pricing of $2 / $10 per MTok applies through 2026-08-31.
// We meter at LIST price on purpose: the scoreboard should not quietly bake in a
// promotional rate that expires mid-demo and silently re-prices historical CAC.
export const ANTHROPIC_INPUT_USD_PER_TOKEN = 3 / 1_000_000;
export const ANTHROPIC_OUTPUT_USD_PER_TOKEN = 15 / 1_000_000;

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
// self-serve (-> cents at Enterprise)". PDL bills per MATCHED record only, so a
// 404 no-match is metered at units = 0 (a cost_events row is still written — the
// call happened, it just cost nothing).
export const PDL_USD_PER_MATCHED_RECORD = 0.28;

export const PDL_PERSON_ENRICH_URL =
  "https://api.peopledatalabs.com/v5/person/enrich";
export const PDL_COMPANY_ENRICH_URL =
  "https://api.peopledatalabs.com/v5/company/enrich";

/**
 * PDL returns a `likelihood` of 1-10 on person enrichment. Below 6 the match is
 * a guess; a guessed work email sent to a real practice is exactly the failure
 * D9 forbids, so we treat a low-likelihood match as NO match and degrade to the
 * role-only variant. https://docs.peopledatalabs.com/docs/reference-person-enrichment-api
 */
export const PDL_MIN_LIKELIHOOD = 6;

// ─── Shared ───────────────────────────────────────────────────────────────────

/** Mirrors DETECTOR_FETCH_TIMEOUT_MS in `src/detectors/`. Research is slower. */
export const ENRICH_FETCH_TIMEOUT_MS = 120_000;
export const PDL_FETCH_TIMEOUT_MS = 20_000;

/** `cost_events.pipeline_step` values — the scoreboard slices spend on these. */
export const PIPELINE_STEP_RESEARCH = "enrich.research";
export const PIPELINE_STEP_PDL = "enrich.pdl";

/**
 * Total USD for ONE Anthropic Messages request: tokens (input, output, cache
 * write, cache read) plus the server-side web-search charge that rides inside the
 * same HTTP call. Web fetch adds nothing beyond tokens.
 *
 * One paid HTTP call -> one `cost_events` row (see `db/schema/roi.ts`), with the
 * component breakdown carried in `meta` so U12 can split token spend from
 * search spend without a second, synthetic wrapper.
 */
export function anthropicCallCostUsd(usage: ClaudeUsage): number {
  const input = usage.inputTokens * ANTHROPIC_INPUT_USD_PER_TOKEN;
  const output = usage.outputTokens * ANTHROPIC_OUTPUT_USD_PER_TOKEN;
  const cacheWrite =
    usage.cacheCreationInputTokens *
    ANTHROPIC_INPUT_USD_PER_TOKEN *
    ANTHROPIC_CACHE_WRITE_MULTIPLIER;
  const cacheRead =
    usage.cacheReadInputTokens *
    ANTHROPIC_INPUT_USD_PER_TOKEN *
    ANTHROPIC_CACHE_READ_MULTIPLIER;
  const search = usage.webSearchRequests * WEB_SEARCH_USD_PER_REQUEST;
  const fetch = usage.webFetchRequests * WEB_FETCH_USD_PER_REQUEST;
  return input + output + cacheWrite + cacheRead + search + fetch;
}

/** The `meta` breakdown written alongside each Anthropic cost_events row. */
export function anthropicCostBreakdown(
  usage: ClaudeUsage,
): Record<string, unknown> {
  return {
    model: RESEARCH_MODEL,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    webSearchRequests: usage.webSearchRequests,
    webFetchRequests: usage.webFetchRequests,
    webSearchUsd: usage.webSearchRequests * WEB_SEARCH_USD_PER_REQUEST,
    tokenUsd:
      anthropicCallCostUsd(usage) -
      usage.webSearchRequests * WEB_SEARCH_USD_PER_REQUEST -
      usage.webFetchRequests * WEB_FETCH_USD_PER_REQUEST,
  };
}
