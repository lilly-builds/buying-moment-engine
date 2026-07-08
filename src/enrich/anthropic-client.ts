import { z } from "zod";
import {
  consumeSseStream,
  describeFailure,
  StreamAccumulator,
} from "./anthropic-stream";
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
  // No default: a body missing `model` falls to the salvage tiers, which label it with
  // the CALLER's model rather than assuming the agentic one.
  model: z.string().optional(),
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

function salvageModel(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null && "model" in body) {
    const model = (body as { model: unknown }).model;
    if (typeof model === "string" && model.length > 0) return model;
  }
  return fallback;
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
 *
 * `fallbackModel` labels the row when even the body's `model` field is gone. It only
 * ever reaches an already-flagged `unpriced` row, so a default is safe here in a way
 * it is NOT for a rate card — see `ModelRates`. `extract.ts` passes `EXTRACT_MODEL`.
 */
export function parseMessagesResponse(
  body: unknown,
  fallbackModel: string = RESEARCH_MODEL,
): ResearchResponse {
  const parsed = messagesResponseSchema.safeParse(body);
  if (parsed.success) {
    return {
      text: collectText(parsed.data.content),
      usage: normalizeUsage(parsed.data.usage),
      model: parsed.data.model ?? fallbackModel,
    };
  }

  const usage = salvageUsage(body);
  if (usage) return { text: "", usage, model: salvageModel(body, fallbackModel) };

  return {
    text: "",
    usage: ZERO_USAGE,
    model: salvageModel(body, fallbackModel),
    unpricedReason: UNPARSEABLE_ENVELOPE,
  };
}

/**
 * Read a BILLED 200's body without throwing. A 200 that is not JSON at all — or whose
 * body stream dies mid-read (socket reset, or the request timeout firing after the
 * headers landed) — was still charged, so it must reach `parseMessagesResponse`, which
 * degrades it to an unpriced-but-recorded call, rather than throw past the meter.
 *
 * The READ is inside the guard, not just the parse: `res.text()` rejects on a broken
 * stream, and that rejection would unwind exactly as far as the `JSON.parse` we are
 * guarding against. The undefined is not a swallowed error — it is the "unrecognized
 * body" that tier 3 of `parseMessagesResponse` exists to handle.
 *
 * Exported for `extract.ts`: both clients face the same billed-200 hazard, and one
 * implementation means one place for the rule to live.
 */
export async function readJsonBody(res: Response): Promise<unknown> {
  try {
    return JSON.parse(await res.text()) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * `stream: true` is not a nicety. Un-streamed, this request writes no headers until all
 * 16 server-side tool calls finish, and undici aborts it at 300s — billed, unrecorded.
 * See `anthropic-stream.ts`.
 */
export function buildRequestBody(request: ResearchRequest) {
  return {
    model: RESEARCH_MODEL,
    max_tokens: RESEARCH_MAX_TOKENS,
    stream: true,
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

/** `meta.reason` on a 200 that opened and then produced nothing at all. */
export const EMPTY_STREAM = "empty-stream";

/**
 * Fold a (possibly dead) stream into a `ResearchResponse`. Three tiers, most to least
 * information — the same ladder `parseMessagesResponse` walks, for the same reason:
 *
 *  1. events arrived -> text + usage, PRICED from the tokens we saw, even if the socket
 *     then died mid-body. A truncated answer parses to "no JSON object found" downstream;
 *     the money is still on the ledger.
 *  2. no events, but the stream failed -> unpriced, with `err.cause.code` as the reason.
 *  3. no events, no failure (a 200 that closed silently) -> unpriced, `EMPTY_STREAM`.
 *
 * Never throws. Everything reaching this function was billed the moment the 200 landed.
 *
 * `fallbackModel` labels the row only when the stream died before its `message_start` event
 * carried the real model — always an already-unpriced row. It defaults to `RESEARCH_MODEL`
 * for the agentic client; the brief's voice client passes `VOICE_MODEL`, exactly as
 * `parseMessagesResponse` takes the same argument for the non-streaming path.
 */
export function streamToResponse(
  accumulator: StreamAccumulator,
  failure: string | null,
  fallbackModel: string = RESEARCH_MODEL,
): ResearchResponse {
  // A mid-stream `error` event on a 200 is Anthropic's own failure channel.
  const streamError = failure ?? accumulator.apiError ?? undefined;

  if (accumulator.sawAnyEvent) {
    return {
      text: accumulator.text,
      usage: accumulator.usage,
      model: accumulator.model ?? fallbackModel,
      ...(streamError === undefined ? {} : { streamError }),
    };
  }

  return {
    text: "",
    usage: ZERO_USAGE,
    model: accumulator.model ?? fallbackModel,
    unpricedReason: streamError ?? EMPTY_STREAM,
    ...(streamError === undefined ? {} : { streamError }),
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
        // A TOTAL-duration guard now, not a headers one. Streaming took that job away.
        signal: AbortSignal.timeout(ENRICH_FETCH_TIMEOUT_MS),
      });
      // Non-2xx is an UNBILLED call: throw, and the meter correctly records
      // nothing. Past this line the request is billed, so nothing may throw.
      if (!res.ok) {
        throw new AnthropicRequestError(res.status, res.statusText);
      }

      const accumulator = new StreamAccumulator();
      let failure: string | null = null;
      if (res.body === null) {
        failure = "no response body on a 200";
      } else {
        try {
          await consumeSseStream(res.body, accumulator);
        } catch (err) {
          // The socket died on a call Anthropic already charged for. `describeFailure`
          // digs out `err.cause.code`, because "TypeError: fetch failed" diagnoses nothing.
          failure = describeFailure(err);
        }
      }
      return streamToResponse(accumulator, failure);
    },
  };
}
