import { z } from "zod";
import {
  ANTHROPIC_API_URL,
  ANTHROPIC_API_VERSION,
  ENRICH_FETCH_TIMEOUT_MS,
  RESEARCH_MAX_TOKENS,
  RESEARCH_MODEL,
  WEB_FETCH_MAX_USES,
  WEB_FETCH_TOOL_NAME,
  WEB_FETCH_TOOL_TYPE,
  WEB_SEARCH_MAX_USES,
  WEB_SEARCH_TOOL_NAME,
  WEB_SEARCH_TOOL_TYPE,
} from "./config";
import { buildResearchPrompt, RESEARCH_SYSTEM_PROMPT } from "./research-prompt";
import {
  AnthropicRequestError,
  ZERO_USAGE,
  type ClaudeUsage,
  type ResearchClient,
  type ResearchRequest,
  type ResearchResponse,
} from "./types";

/**
 * The ONE piece of Anthropic I/O in the repo's enrichment path (U5). Thin by
 * design — build the request, POST it, normalize `usage`, hand back raw text.
 * It never parses findings and never decides cost; those are pure functions
 * elsewhere, so the seam mocks cleanly and the logic tests without a network.
 *
 * Sonnet 5 notes (verified against the API docs, not recalled):
 *  - adaptive thinking is ON when `thinking` is omitted — we omit it.
 *  - `temperature` / `top_p` / `top_k` are REJECTED with a 400. Never send them.
 *  - `effort` defaults to `high` on the Claude API.
 *  - server-side web_search/web_fetch `_20260209` run dynamic filtering inside
 *    code execution; we must NOT also declare `code_execution` in `tools`.
 */

const usageSchema = z.object({
  input_tokens: z.number().default(0),
  output_tokens: z.number().default(0),
  cache_creation_input_tokens: z.number().nullish(),
  cache_read_input_tokens: z.number().nullish(),
  server_tool_use: z
    .object({
      web_search_requests: z.number().nullish(),
      web_fetch_requests: z.number().nullish(),
    })
    .nullish(),
});

const messagesResponseSchema = z.object({
  model: z.string().default(RESEARCH_MODEL),
  stop_reason: z.string().nullish(),
  content: z.array(z.object({ type: z.string() }).loose()).default([]),
  usage: usageSchema,
});

/** Concatenate every top-level `text` block. Server-tool blocks are ignored. */
export function collectText(content: Array<{ type: string }>): string {
  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        block.type === "text" &&
        typeof (block as { text?: unknown }).text === "string",
    )
    .map((block) => block.text)
    .join("\n");
}

export function normalizeUsage(
  usage: z.output<typeof usageSchema>,
): ClaudeUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    webSearchRequests: usage.server_tool_use?.web_search_requests ?? 0,
    webFetchRequests: usage.server_tool_use?.web_fetch_requests ?? 0,
  };
}

/** `meta.reason` on a cost row we could not price. Asserted by the tests. */
export const UNPARSEABLE_ENVELOPE = "unparseable-envelope";

/**
 * Anthropic returns `usage` even on a response whose content blocks we do not
 * recognize, so a body that fails the full envelope schema can still be PRICED.
 * Returns null only when the usage block itself is unsalvageable.
 */
function salvageUsage(body: unknown): ClaudeUsage | null {
  if (typeof body !== "object" || body === null || !("usage" in body)) return null;
  const parsed = usageSchema.safeParse((body as { usage: unknown }).usage);
  return parsed.success ? normalizeUsage(parsed.data) : null;
}

function salvageModel(body: unknown): string {
  if (typeof body === "object" && body !== null && "model" in body) {
    const model = (body as { model: unknown }).model;
    if (typeof model === "string" && model.length > 0) return model;
  }
  return RESEARCH_MODEL;
}

/**
 * Parse a raw Messages-API body into our `ResearchResponse`. Pure, and it NEVER
 * throws: every body handed to it came back on a 200, which Anthropic has already
 * billed. Throwing here would unwind past the cost meter and record nothing —
 * the exact failure `src/roi/cost-meter.ts` documents as forbidden ("errors that
 * DID cost money must surface as a resolved result, not a throw").
 *
 * Three tiers, most to least information:
 *  1. the full envelope parses -> text + usage + model.
 *  2. only `usage` survives -> no text, but the call is priced correctly.
 *  3. nothing survives -> zeroed usage + `unpricedReason`, so the ledger still
 *     carries a row saying a paid call happened that we could not price.
 *
 * An empty `text` is "no findings" downstream (`research-schema.ts` reports
 * "no JSON object found"), never a crash.
 */
export function parseMessagesResponse(body: unknown): ResearchResponse {
  const parsed = messagesResponseSchema.safeParse(body);
  if (parsed.success) {
    return {
      text: collectText(parsed.data.content),
      usage: normalizeUsage(parsed.data.usage),
      model: parsed.data.model,
    };
  }

  const usage = salvageUsage(body);
  if (usage) return { text: "", usage, model: salvageModel(body) };

  return {
    text: "",
    usage: ZERO_USAGE,
    model: salvageModel(body),
    unpricedReason: UNPARSEABLE_ENVELOPE,
  };
}

/**
 * Read a BILLED 200's body without throwing. A 200 that is not JSON at all was
 * still charged, so it must reach `parseMessagesResponse` — which degrades it to
 * an unpriced-but-recorded call — rather than throw past the meter. The undefined
 * is not a swallowed error: it is the "unrecognized body" tier 3 exists to handle.
 */
async function readJsonBody(res: Response): Promise<unknown> {
  const raw = await res.text();
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export function buildRequestBody(request: ResearchRequest) {
  return {
    model: RESEARCH_MODEL,
    max_tokens: RESEARCH_MAX_TOKENS,
    system: RESEARCH_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildResearchPrompt(request) }],
    tools: [
      {
        type: WEB_SEARCH_TOOL_TYPE,
        name: WEB_SEARCH_TOOL_NAME,
        max_uses: WEB_SEARCH_MAX_USES,
      },
      {
        type: WEB_FETCH_TOOL_TYPE,
        name: WEB_FETCH_TOOL_NAME,
        max_uses: WEB_FETCH_MAX_USES,
        citations: { enabled: true },
      },
    ],
  };
}

/** Production binding. `apiKey` is injected, never read from the module scope. */
export function anthropicResearchClient(apiKey: string): ResearchClient {
  return {
    async research(request: ResearchRequest): Promise<ResearchResponse> {
      const res = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_API_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify(buildRequestBody(request)),
        signal: AbortSignal.timeout(ENRICH_FETCH_TIMEOUT_MS),
      });
      // Non-2xx is an UNBILLED call: throw, and the meter correctly records
      // nothing. Past this line the request is billed, so nothing may throw —
      // `parseMessagesResponse` degrades instead.
      if (!res.ok) {
        throw new AnthropicRequestError(res.status, res.statusText);
      }
      return parseMessagesResponse(await readJsonBody(res));
    },
  };
}
