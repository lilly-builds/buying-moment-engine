import { z } from "zod";
import { causeCode } from "./fetch-retry";
import type { ClaudeUsage } from "./types";

/**
 * SSE accumulation for the agentic escalation call. Pure except `consumeSseStream`,
 * which only reads bytes — so the token math tests without a network.
 *
 * ─── Why the escalation path streams (KTD-8) ──────────────────────────────────
 *
 * The 300-second wall that killed 1 of 3 agentic calls was never a duration limit. It
 * was `undici@7.28.0 lib/dispatcher/client.js:262` — `headersTimeout = 300e3`, the time
 * allowed for the FIRST BYTE OF HEADERS. A non-streaming agentic request runs up to 8
 * web searches and 8 page fetches server-side before Anthropic writes a single header,
 * so a slow practice blows the ceiling while the request is working perfectly. The call
 * is billed; the socket dies; `res.text()` rejects; the meter records nothing; CAC
 * silently understates by $1.27 exactly on the calls that took the longest.
 *
 * With `stream: true` headers return immediately and `headersTimeout` cannot fire.
 *
 * What remains is `bodyTimeout` (`:261`, also `300e3`), which measures the gap BETWEEN
 * chunks, not total duration. Anthropic emits periodic `ping` events, so a working call
 * resets it continuously. That is a real, narrower guard, and it is the one we want.
 *
 * ─── Why the tokens are accumulated rather than read at the end ───────────────
 *
 * `message_start` carries the input tokens; `message_delta` carries the final output
 * count. Holding both as they arrive means a stream that dies mid-body still yields a
 * PRICED `cost_events` row instead of $0.00. A paid call we could not price is bad; a
 * paid call recorded as free is a lie in the one number this repo exists to measure.
 */

const streamUsageSchema = z.object({
  input_tokens: z.number().nullish(),
  output_tokens: z.number().nullish(),
  cache_creation_input_tokens: z.number().nullish(),
  cache_read_input_tokens: z.number().nullish(),
  server_tool_use: z
    .object({
      web_search_requests: z.number().nullish(),
      web_fetch_requests: z.number().nullish(),
    })
    .nullish(),
});

const messageStartSchema = z.object({
  message: z
    .object({ model: z.string().nullish(), usage: streamUsageSchema.nullish() })
    .loose(),
});

const contentDeltaSchema = z.object({
  delta: z.object({ type: z.string(), text: z.string().nullish() }).loose(),
});

const messageDeltaSchema = z.object({
  delta: z.object({ stop_reason: z.string().nullish() }).loose().nullish(),
  usage: streamUsageSchema.nullish(),
});

const errorEventSchema = z.object({
  error: z.object({ type: z.string().nullish(), message: z.string().nullish() }).loose(),
});

/**
 * Frames are separated by a blank line. Returns only COMPLETE frames' `data:` payloads;
 * the trailing partial frame stays in `rest` for the next chunk. A frame torn across a
 * TCP boundary must never be parsed as if it were whole.
 */
export function extractSseData(buffer: string): { payloads: string[]; rest: string } {
  const frames = buffer.split("\n\n");
  const rest = frames.pop() ?? "";
  const payloads: string[] = [];
  for (const frame of frames) {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim())
      .join("");
    if (data.length > 0) payloads.push(data);
  }
  return { payloads, rest };
}

/**
 * Everything we can salvage from a stream, at any point in its life. `sawAnyEvent` is
 * the fork the meter cares about: false means we cannot price the call at all.
 */
export class StreamAccumulator {
  private textParts: string[] = [];
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheCreationInputTokens = 0;
  private cacheReadInputTokens = 0;
  private webSearchRequests = 0;
  private webFetchRequests = 0;

  events = 0;
  /** A complete frame whose payload was not JSON. Counted, never silently dropped. */
  malformedFrames = 0;
  model: string | null = null;
  stopReason: string | null = null;
  /** An `error` event on a 200 stream — Anthropic's mid-stream failure channel. */
  apiError: string | null = null;

  get sawAnyEvent(): boolean {
    return this.events > 0;
  }

  get text(): string {
    return this.textParts.join("");
  }

  get usage(): ClaudeUsage {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheCreationInputTokens: this.cacheCreationInputTokens,
      cacheReadInputTokens: this.cacheReadInputTokens,
      webSearchRequests: this.webSearchRequests,
      webFetchRequests: this.webFetchRequests,
    };
  }

  /** Later counts REPLACE earlier ones: Anthropic reports usage cumulatively. */
  private applyUsage(usage: z.output<typeof streamUsageSchema>): void {
    if (usage.input_tokens != null) this.inputTokens = usage.input_tokens;
    if (usage.output_tokens != null) this.outputTokens = usage.output_tokens;
    if (usage.cache_creation_input_tokens != null) {
      this.cacheCreationInputTokens = usage.cache_creation_input_tokens;
    }
    if (usage.cache_read_input_tokens != null) {
      this.cacheReadInputTokens = usage.cache_read_input_tokens;
    }
    const tools = usage.server_tool_use;
    if (tools?.web_search_requests != null) this.webSearchRequests = tools.web_search_requests;
    if (tools?.web_fetch_requests != null) this.webFetchRequests = tools.web_fetch_requests;
  }

  apply(event: unknown): void {
    const envelope = z.object({ type: z.string() }).loose().safeParse(event);
    if (!envelope.success) {
      this.malformedFrames += 1;
      return;
    }
    this.events += 1;

    switch (envelope.data.type) {
      case "message_start": {
        const parsed = messageStartSchema.safeParse(event);
        if (!parsed.success) return;
        this.model = parsed.data.message.model ?? this.model;
        if (parsed.data.message.usage) this.applyUsage(parsed.data.message.usage);
        return;
      }
      case "content_block_delta": {
        const parsed = contentDeltaSchema.safeParse(event);
        // `input_json_delta` (tool args) and `citations_delta` are not the answer text.
        if (parsed.success && parsed.data.delta.type === "text_delta" && parsed.data.delta.text) {
          this.textParts.push(parsed.data.delta.text);
        }
        return;
      }
      case "message_delta": {
        const parsed = messageDeltaSchema.safeParse(event);
        if (!parsed.success) return;
        this.stopReason = parsed.data.delta?.stop_reason ?? this.stopReason;
        if (parsed.data.usage) this.applyUsage(parsed.data.usage);
        return;
      }
      case "error": {
        const parsed = errorEventSchema.safeParse(event);
        if (parsed.success) {
          this.apiError = parsed.data.error.message ?? parsed.data.error.type ?? "stream error";
        }
        return;
      }
      default:
        return; // ping, content_block_start/stop, message_stop
    }
  }
}

/**
 * Read the stream to exhaustion, feeding whole frames to `apply`. Throws whatever the
 * socket throws — the CALLER decides that a mid-stream death is a billed, priced call
 * rather than an error, because only the caller knows the request already got a 200.
 */
export async function consumeSseStream(
  stream: ReadableStream<Uint8Array>,
  accumulator: StreamAccumulator,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { payloads, rest } = extractSseData(buffer);
    buffer = rest;
    for (const payload of payloads) {
      try {
        accumulator.apply(JSON.parse(payload) as unknown);
      } catch {
        // A COMPLETE frame whose payload is not JSON. Not a torn read — a real defect,
        // ours or theirs. Counted so it reaches the cost row's meta rather than vanishing.
        accumulator.malformedFrames += 1;
      }
    }
  }
}

/**
 * Turn a socket failure into an evidence string, not a shrug.
 *
 * Node's `fetch` wraps the real fault: the outer error is always `TypeError: fetch
 * failed`, and the diagnosis — `UND_ERR_HEADERS_TIMEOUT`, `ECONNRESET`, `UND_ERR_SOCKET`
 * — lives on `err.cause.code`. Logging only the outer message is how a 300-second
 * `headersTimeout` was recorded for months as "fetch failed" and diagnosed as "Anthropic
 * is slow." This is what turns E2's mechanism into per-incident proof.
 */
export function describeFailure(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const code = causeCode(err);
  const label = `${err.name}: ${err.message}`;
  return code === null ? label : `${label} (cause: ${code})`;
}
