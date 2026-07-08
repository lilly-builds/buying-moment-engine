import { describe, expect, it, vi } from "vitest";
import {
  causeCode,
  isRetryableError,
  isTransientStatus,
  TransientHttpError,
  withRetry,
} from "@/src/enrich/fetch-retry";

/** `sleep` and `jitter` are injected, so nothing here actually waits. */
const NO_WAIT = { sleep: async () => {}, jitter: () => 0 };

function options(overrides: Partial<Parameters<typeof withRetry>[1]> = {}) {
  return { maxRetries: 2, baseDelayMs: 300, label: "test", ...NO_WAIT, ...overrides };
}

/** undici hides the real failure under `err.cause`; the message is just "fetch failed". */
function fetchFailed(code: string): Error {
  return new TypeError("fetch failed", { cause: Object.assign(new Error(code), { code }) });
}

describe("isTransientStatus", () => {
  it.each([408, 425, 429, 500, 502, 503, 504])("%d is worth retrying", (status) => {
    expect(isTransientStatus(status)).toBe(true);
  });

  it.each([200, 301, 400, 401, 403, 404, 410])("%d is the server's final answer", (status) => {
    expect(isTransientStatus(status)).toBe(false);
  });
});

describe("isRetryableError", () => {
  it("a transient status raised as an error is retryable", () => {
    expect(isRetryableError(new TransientHttpError(503, "https://x.example"))).toBe(true);
  });

  it("reads the real cause out of undici's generic `fetch failed`", () => {
    expect(isRetryableError(fetchFailed("ECONNRESET"))).toBe(true);
    expect(isRetryableError(fetchFailed("UND_ERR_HEADERS_TIMEOUT"))).toBe(true);
  });

  it("an AbortSignal timeout is retryable", () => {
    const err = new Error("The operation was aborted");
    err.name = "TimeoutError";
    expect(isRetryableError(err)).toBe(true);
  });

  it("a plain programming error is NOT retryable", () => {
    expect(isRetryableError(new TypeError("x is not a function"))).toBe(false);
    expect(isRetryableError("a string")).toBe(false);
    expect(isRetryableError(null)).toBe(false);
  });

  it("causeCode digs a string code out of an unknown cause, or returns null", () => {
    expect(causeCode(fetchFailed("ENOTFOUND"))).toBe("ENOTFOUND");
    expect(causeCode(new Error("plain"))).toBeNull();
    expect(causeCode(new Error("x", { cause: "a string" }))).toBeNull();
    expect(causeCode(new Error("x", { cause: { code: 42 } }))).toBeNull();
  });
});

describe("withRetry — throw-retry, and ONLY throw-retry", () => {
  it("returns the first success without sleeping", async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn(async () => "ok");
    await expect(withRetry(fn, options({ sleep }))).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries a transient failure and succeeds on a later attempt", async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw new TransientHttpError(503, "https://x.example");
      return "ok";
    });
    await expect(withRetry(fn, options())).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("rethrows after the retry budget is exhausted", async () => {
    const fn = vi.fn(async () => {
      throw new TransientHttpError(500, "https://x.example");
    });
    await expect(withRetry(fn, options())).rejects.toThrow(TransientHttpError);
    expect(fn).toHaveBeenCalledTimes(3); // 1 attempt + 2 retries
  });

  it("does NOT retry a non-retryable error — it fails on attempt one", async () => {
    const fn = vi.fn(async () => {
      throw new TypeError("x is not a function");
    });
    await expect(withRetry(fn, options())).rejects.toThrow("x is not a function");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("backs off exponentially, with jitter scaled to the base delay", async () => {
    const delays: number[] = [];
    const fn = async () => {
      throw new TransientHttpError(503, "https://x.example");
    };
    await expect(
      withRetry(fn, options({ sleep: async (ms) => void delays.push(ms), jitter: () => 0.5 })),
    ).rejects.toThrow();

    // 300*2^0 + 0.5*300 = 450 ; 300*2^1 + 0.5*300 = 750
    expect(delays).toEqual([450, 750]);
  });

  it("reports each retry attempt to the caller", async () => {
    const onRetry = vi.fn();
    const fn = async () => {
      throw new TransientHttpError(429, "https://x.example");
    };
    await expect(withRetry(fn, options({ onRetry }))).rejects.toThrow();
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls[0][0]).toBe(1);
  });

  it("EDGE CASE: maxRetries 0 means exactly one attempt", async () => {
    const fn = vi.fn(async () => {
      throw new TransientHttpError(503, "https://x.example");
    });
    await expect(withRetry(fn, options({ maxRetries: 0 }))).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("KTD-7 GUARD: a bad RESULT is not a throw, so it is never retried here", async () => {
    // The Optiflow Gate-4 bug in one assertion. `withRetry` must hand a returned
    // failure straight back — retrying an identical paid call on identical input
    // buys three identical answers. Escalation belongs in the waterfall.
    const fn = vi.fn(async () => ({ passed: false, reason: "confidence too low" }));
    await expect(withRetry(fn, options())).resolves.toEqual({
      passed: false,
      reason: "confidence too low",
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
