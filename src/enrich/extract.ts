import type { Meter } from "@/src/roi/cost-meter";
import { parseMessagesResponse, readJsonBody } from "./anthropic-client";
import {
  ANTHROPIC_API_URL,
  ANTHROPIC_API_VERSION,
  anthropicCallCostUsd,
  anthropicCostBreakdown,
  EXTRACT_FETCH_TIMEOUT_MS,
  EXTRACT_MAX_TOKENS,
  EXTRACT_MODEL,
  EXTRACT_RATES,
  PIPELINE_STEP_EXTRACT,
} from "./config";
import { buildExtractPrompt, EXTRACT_JSON_SCHEMA, EXTRACT_SYSTEM_PROMPT } from "./extract-prompt";
import { parseResearchOutput } from "./research-schema";
import {
  AnthropicRequestError,
  type ClaudeUsage,
  type ExtractClient,
  type ExtractRequest,
  type ResearchFindings,
  type ResearchResponse,
} from "./types";

/**
 * Stage 1 of the waterfall, replacing agentic browsing: ONE Haiku 4.5 call turns page
 * text we already scraped into cited `ResearchFindings`.
 *
 * The mechanism change is the whole point. The old path paid Claude to browse — 8
 * server-side searches + 8 fetches, 357,500 input tokens, $1.27 and 4-5 minutes per
 * practice, and a 300s `headersTimeout` that killed 1 call in 3 while recording $0.00.
 * Holding the pages ourselves and asking a small model to read them measured at
 * $0.0091-$0.0125 (E5, n=6) — ~128x cheaper — with no wall to hit, because there is
 * nothing for the server to go do.
 *
 * And it buys the thing money cannot: `citations.ts` can now check the model's snippet
 * against the bytes it was shown. D2 stops being a sentence in a prompt.
 *
 * R19: the call is wrapped in `meter`, one `cost_events` row per HTTP request.
 * `unitCostUsd` resolves from the response's own `usage`, priced at `EXTRACT_RATES`.
 *
 * PARSING HAPPENS OUTSIDE THE METER, exactly as `research.ts` documents. A billed 200
 * whose body we cannot read still cost money; parsing inside `fn` would throw, the
 * meter would record nothing, and measured CAC would understate spend precisely on
 * the calls that went wrong. That is the failure mode this repo already paid for once.
 */

export interface ExtractDeps {
  client: ExtractClient;
  meter: Meter;
  practiceId?: string | null;
}

export type ExtractOutcome =
  | { ok: true; findings: ResearchFindings; usage: ClaudeUsage; model: string }
  | { ok: false; reason: string; usage: ClaudeUsage; model: string };

export async function runExtract(
  deps: ExtractDeps,
  request: ExtractRequest,
): Promise<ExtractOutcome> {
  const response = await deps.meter(
    {
      provider: "anthropic",
      operation: "messages.create",
      // Distinct from PIPELINE_STEP_RESEARCH so the scoreboard can price the primary
      // path against the escalation it replaced, on the same practice.
      pipelineStep: PIPELINE_STEP_EXTRACT,
      practiceId: deps.practiceId ?? null,
      units: 1,
      unitCostUsd: (res) => anthropicCallCostUsd(res.usage, EXTRACT_RATES),
      meta: (res) => ({
        ...anthropicCostBreakdown(res.usage, EXTRACT_RATES),
        practiceName: request.practiceName,
        pagesHeld: request.pages.size,
        ...(res.unpricedReason === undefined
          ? {}
          : { unpriced: true, reason: res.unpricedReason }),
      }),
    },
    () => deps.client.extract(request),
  );

  // Structured outputs return bare JSON, so `extractJsonObject`'s balanced-brace scan
  // is a no-op here — kept on this path anyway because a `stop_reason: "max_tokens"`
  // truncation produces syntactically incomplete JSON, and the scanner makes
  // `JSON.parse` report the real syntax error instead of "no JSON object found".
  // The API guarantees SHAPE. Only zod, and then `citations.ts`, speak to truth.
  const parsed = parseResearchOutput(response.text);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason, usage: response.usage, model: response.model };
  }
  return { ok: true, findings: parsed.findings, usage: response.usage, model: response.model };
}

/**
 * The request body. No `thinking` (Haiku 4.5 has none — omitting it is how you get
 * none), no `effort` (errors on Haiku), no `temperature`/`top_p`/`top_k`, and no
 * prompt caching: Haiku's minimum cacheable prefix is 4,096 tokens, and this system
 * prompt is far shorter, so a `cache_control` block would silently no-op while
 * implying a saving that never lands in `cost_events`.
 *
 * `output_config.format` is the canonical parameter; `output_format` is deprecated.
 */
export function buildExtractRequestBody(request: ExtractRequest) {
  return {
    model: EXTRACT_MODEL,
    max_tokens: EXTRACT_MAX_TOKENS,
    system: EXTRACT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildExtractPrompt(request) }],
    output_config: {
      format: { type: "json_schema", schema: EXTRACT_JSON_SCHEMA },
    },
  };
}

/**
 * Production binding. `apiKey` is injected, never read from module scope.
 *
 * Raw `fetch`, not the Anthropic SDK, and deliberately: the SDK THROWS on a non-2xx
 * and on a body it cannot decode. A billed 200 must resolve so the meter writes its
 * row — the boundary above depends on it. It also matches `anthropic-client.ts` and
 * `pdl-client.ts`, and keeps `cheerio` the only dependency this refactor adds.
 */
export function anthropicExtractClient(apiKey: string): ExtractClient {
  return {
    async extract(request: ExtractRequest): Promise<ResearchResponse> {
      const res = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_API_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify(buildExtractRequestBody(request)),
        signal: AbortSignal.timeout(EXTRACT_FETCH_TIMEOUT_MS),
      });
      // Non-2xx is an UNBILLED call: throw, and the meter correctly records nothing.
      // Past this line the request is billed, so nothing may throw.
      if (!res.ok) throw new AnthropicRequestError(res.status, res.statusText);
      return parseMessagesResponse(await readJsonBody(res), EXTRACT_MODEL);
    },
  };
}
