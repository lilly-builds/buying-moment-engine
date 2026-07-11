import { streamToResponse } from "@/src/enrich/anthropic-client";
import {
  consumeSseStream,
  describeFailure,
  StreamAccumulator,
} from "@/src/enrich/anthropic-stream";
import { ANTHROPIC_API_URL, ANTHROPIC_API_VERSION } from "@/src/enrich/config";
import { AnthropicRequestError, type ResearchResponse } from "@/src/enrich/types";
import { ADAPT_EFFORT, ADAPT_FETCH_TIMEOUT_MS, ADAPT_MODEL } from "./config";

/**
 * The ONE piece of Anthropic I/O for the Adapt-It onboarding (Phase 3). It reuses
 * the repo's existing streaming idiom whole (`StreamAccumulator` +
 * `consumeSseStream` + `streamToResponse`, the exact shape `anthropicVoiceClient`
 * and `anthropicResearchClient` use) rather than adding a new SDK path.
 *
 * Sonnet 5 request notes, verified against the Sonnet 5 surface (not recalled):
 *  - adaptive thinking is ON when `thinking` is omitted — we omit it; the
 *    accumulator keeps only `text_delta`s, so the thinking deltas are ignored and
 *    the collected text is the pure JSON answer.
 *  - `temperature` / `top_p` / `top_k` are REJECTED with a 400. Never send them.
 *  - `effort` lives INSIDE `output_config`, alongside `format`. Top-level is a 400.
 *  - structured outputs (`output_config.format` json_schema) are supported and are
 *    what guarantee the response SHAPE; Zod then re-checks it before use.
 *  - `stream: true` is not a nicety: with a large `max_tokens` an un-streamed call
 *    writes no headers until generation finishes and `AbortSignal.timeout` fires on
 *    the fetch promise itself. Streaming returns headers immediately.
 *
 * The seam (`AdaptClient`) is an interface so the route logic tests without a
 * network — a fake client returns canned text and the generate/finalize functions
 * still exercise their real parse-validate-fallback path.
 */

export interface AdaptRequest {
  system: string;
  prompt: string;
  /** The JSON Schema handed to `output_config.format` — structured outputs. */
  schema: Record<string, unknown>;
  maxTokens: number;
}

export interface AdaptClient {
  complete(request: AdaptRequest): Promise<ResearchResponse>;
}

export function buildAdaptRequestBody(request: AdaptRequest) {
  return {
    model: ADAPT_MODEL,
    max_tokens: request.maxTokens,
    stream: true,
    system: request.system,
    messages: [{ role: "user", content: request.prompt }],
    output_config: {
      effort: ADAPT_EFFORT,
      format: { type: "json_schema", schema: request.schema },
    },
  };
}

/** Production binding. `apiKey` is injected, never read from module scope. */
export function anthropicAdaptClient(apiKey: string): AdaptClient {
  return {
    async complete(request: AdaptRequest): Promise<ResearchResponse> {
      const res = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_API_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify(buildAdaptRequestBody(request)),
        signal: AbortSignal.timeout(ADAPT_FETCH_TIMEOUT_MS),
      });
      // Non-2xx throws; the generate/finalize callers catch it and fall back.
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
          failure = describeFailure(err);
        }
      }
      return streamToResponse(accumulator, failure, ADAPT_MODEL);
    },
  };
}
