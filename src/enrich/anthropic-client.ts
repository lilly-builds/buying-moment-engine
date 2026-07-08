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

/** Parse a raw Messages-API body into our `ResearchResponse`. Pure. */
export function parseMessagesResponse(body: unknown): ResearchResponse {
  const parsed = messagesResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new AnthropicRequestError(
      200,
      `unrecognized Messages API response shape: ${parsed.error.issues
        .map((i) => i.path.join("."))
        .join(", ")}`,
    );
  }
  return {
    text: collectText(parsed.data.content),
    usage: normalizeUsage(parsed.data.usage),
    model: parsed.data.model,
  };
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
      if (!res.ok) {
        throw new AnthropicRequestError(res.status, res.statusText);
      }
      return parseMessagesResponse(await res.json());
    },
  };
}
