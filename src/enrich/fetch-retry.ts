/**
 * Exponential backoff for TRANSIENT PAGE FETCHES ONLY. Ported from
 * `lead-gen-optiflow/src/utils/retry.ts`.
 *
 * Read `KTD-7` before reaching for this anywhere else. Optiflow's Gate-4 bug is
 * that `withRetry` only retries a THROWN error, while `gate4-enrich-lead.ts:31`
 * *returns* `{passed: false}` — so a lead that enriched fine but scored 0.39
 * against a 0.4 bar was terminal on attempt 1. This file is the throw-retry half,
 * and it is correct HERE because a page fetch's failures genuinely are thrown
 * (socket reset, DNS, timeout) or are a transient status we convert to a throw.
 *
 * A bad *result* — a scrape that returned a thin page, an extraction that produced
 * zero verified facts — must NEVER be retried by this function. Retrying an
 * identical paid call on identical input buys three identical answers. That
 * escalation lives in `waterfall.ts` and it changes the input or the model.
 */

/** A status worth trying again. Everything else is the server's final answer. */
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export function isTransientStatus(status: number): boolean {
  return TRANSIENT_STATUS.has(status);
}

/**
 * A transient HTTP status, raised so `withRetry` can see it. `fetch` resolves on a
 * 503 — only a throw re-enters the backoff loop.
 */
export class TransientHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`transient HTTP ${status} for ${url}`);
    this.name = "TransientHttpError";
  }
}

/** `AbortSignal.timeout` raises `TimeoutError`; an aborted fetch raises `AbortError`. */
const RETRYABLE_ERROR_NAMES = new Set(["AbortError", "TimeoutError"]);

/** undici surfaces the real cause under `err.cause.code`; the message is just "fetch failed". */
const RETRYABLE_CAUSE_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/** `err.cause` is `unknown` on `Error`; dig out a string `code` without an `any`. */
export function causeCode(err: Error): string | null {
  const cause: unknown = err.cause;
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return null;
  const code: unknown = (cause as { code: unknown }).code;
  return typeof code === "string" ? code : null;
}

export function isRetryableError(err: unknown): boolean {
  if (err instanceof TransientHttpError) return true;
  if (!(err instanceof Error)) return false;
  if (RETRYABLE_ERROR_NAMES.has(err.name)) return true;

  const code = causeCode(err);
  if (code !== null && RETRYABLE_CAUSE_CODES.has(code)) return true;

  // Last resort. `fetch failed` is undici's generic wrapper; the cause carries the truth.
  return /fetch failed|socket hang up|network/i.test(err.message);
}

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  label: string;
  /** Injected so backoff tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected so jittered delays are deterministic in tests. Returns 0..1. */
  jitter?: () => number;
  onRetry?: (attempt: number, err: Error) => void;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry `fn` on a retryable THROW. A non-retryable error and an exhausted budget
 * both rethrow the last error — the caller decides what a give-up means.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  const jitter = opts.jitter ?? Math.random;

  let lastError: Error = new Error(`${opts.label}: never attempted`);
  for (let attempt = 0; attempt <= opts.maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === opts.maxRetries || !isRetryableError(lastError)) throw lastError;
      opts.onRetry?.(attempt + 1, lastError);
      await sleep(opts.baseDelayMs * 2 ** attempt + jitter() * opts.baseDelayMs);
    }
  }
  throw lastError;
}
