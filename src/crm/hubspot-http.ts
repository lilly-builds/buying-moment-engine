/**
 * The one authenticated HubSpot HTTP call (R8, U10). Extracted so the adapter
 * (`hubspot.ts`) and the property provisioner (`hubspot-properties.ts`) share a
 * single retry/timeout/auth policy instead of each growing their own.
 *
 * All I/O is injected: `fetch` (mocked in tests), `getAccessToken` (the proactive
 * refresh lives in the token provider), `sleep` (so backoff tests never wait).
 * The backoff decision itself is a PURE function, unit-tested with no HTTP.
 */

export const HUBSPOT_API_BASE = "https://api.hubapi.com";

/** Bounded network timeout — a stalled HubSpot response must not hang a route. */
export const HUBSPOT_FETCH_TIMEOUT_MS = 15_000;

/**
 * Delay before retrying a 429 (pure). Honors an explicit `Retry-After` (seconds)
 * when HubSpot sends one, else exponential backoff (base * 2^attempt) capped.
 */
export function backoffDelayMs(
  attempt: number,
  baseMs: number,
  retryAfterSeconds?: number | null,
  capMs: number = 30_000,
): number {
  if (retryAfterSeconds != null && Number.isFinite(retryAfterSeconds)) {
    return Math.min(retryAfterSeconds * 1000, capMs);
  }
  return Math.min(baseMs * 2 ** attempt, capMs);
}

export interface HubSpotHttpDeps {
  fetch: typeof fetch;
  /** Returns a VALID access token (the provider refreshes proactively). */
  getAccessToken: () => Promise<string>;
  baseUrl?: string;
  maxRetries?: number;
  /** Base backoff in ms (default 500). */
  backoffBaseMs?: number;
  /** Injected so 429-retry tests don't actually wait. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * An HTTP status the caller wants back as a VALUE rather than as a thrown error.
 * The property provisioner uses this for 409 (already exists) so "ensure" stays
 * idempotent — the R17 rule: never blindly overwrite a real record.
 */
export interface RequestOptions {
  /** Statuses returned as `{ status, body }` instead of throwing. */
  tolerate?: readonly number[];
}

export interface ToleratedResponse {
  tolerated: true;
  status: number;
}

export type HubSpotRequest = <T>(
  method: string,
  path: string,
  body?: unknown,
  options?: RequestOptions,
) => Promise<T | ToleratedResponse>;

export function isTolerated(v: unknown): v is ToleratedResponse {
  return typeof v === "object" && v !== null && "tolerated" in v;
}

/**
 * A normalized, D9-safe reason for a failed HubSpot request. These are the ONLY send
 * failures a user can fix on their side; everything else stays a generic error. The raw
 * HubSpot message/body is NEVER surfaced (it can quote submitted contact values) — only
 * this enum crosses back out.
 */
export type HubSpotErrorReason =
  | "sales_subscription_inactive"
  | "no_connected_inbox"
  | "already_enrolled";

/**
 * Derive a normalized reason from a HubSpot error body. Reads the machine codes
 * (`errorType` / `category`) and the message, but returns ONLY the enum — the raw body
 * is discarded here so it can never leak past this boundary (D9). Returns null for
 * anything unrecognized (which the caller treats as a generic, dev-only failure).
 */
export function classifyHubSpotError(body: unknown): HubSpotErrorReason | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as { errorType?: unknown; category?: unknown; message?: unknown };
  const code = `${typeof b.errorType === "string" ? b.errorType : ""} ${
    typeof b.category === "string" ? b.category : ""
  }`.toUpperCase();
  const msg = typeof b.message === "string" ? b.message : "";
  if (code.includes("NO_CONNECTED_EMAIL") || /connected (personal )?email/i.test(msg)) {
    return "no_connected_inbox";
  }
  if (code.includes("ALREADY_ENROLLED") || /already enrolled/i.test(msg)) {
    return "already_enrolled";
  }
  // "Sales Subscription Status is not OK" comes back as errorType OTHER_SEND_REJECTED
  // (a catch-all), so it's the message that pins it — matched here, never surfaced raw.
  if (/sales subscription/i.test(msg)) return "sales_subscription_inactive";
  return null;
}

/**
 * A failed HubSpot request. Carries the status and a normalized, PII-free `reason` (never
 * the raw body) so the send layer can map a user-fixable failure to a clear message while
 * everything else degrades to a generic error.
 */
export class HubSpotRequestError extends Error {
  readonly status: number;
  readonly reason: HubSpotErrorReason | null;
  constructor(
    method: string,
    path: string,
    status: number,
    reason: HubSpotErrorReason | null,
  ) {
    super(
      `HubSpot ${method} ${path} failed with ${status}${reason ? ` (${reason})` : ""}`,
    );
    this.name = "HubSpotRequestError";
    this.status = status;
    this.reason = reason;
  }
}

/** Build the shared request function bound to one set of deps. */
export function createHubSpotRequest(deps: HubSpotHttpDeps): HubSpotRequest {
  const base = deps.baseUrl ?? HUBSPOT_API_BASE;
  const maxRetries = deps.maxRetries ?? 5;
  const backoffBaseMs = deps.backoffBaseMs ?? 500;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  return async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T | ToleratedResponse> {
    for (let attempt = 0; ; attempt++) {
      const token = await deps.getAccessToken();
      const res = await deps.fetch(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(HUBSPOT_FETCH_TIMEOUT_MS),
      });

      if (res.status === 429 && attempt < maxRetries) {
        const retryAfter = res.headers.get("Retry-After");
        await sleep(
          backoffDelayMs(
            attempt,
            backoffBaseMs,
            retryAfter ? Number(retryAfter) : null,
          ),
        );
        continue; // retry — nothing is lost
      }
      if (options?.tolerate?.includes(res.status)) {
        return { tolerated: true, status: res.status };
      }
      if (!res.ok) {
        // Never echo the response body — HubSpot validation errors quote the submitted
        // property values, which can carry contact data (D9). Read it ONLY to derive a
        // normalized, PII-free reason for user-fixable failures; the raw body is dropped.
        let reason: HubSpotErrorReason | null = null;
        try {
          reason = classifyHubSpotError(await res.json());
        } catch {
          // Non-JSON / empty body — no reason to derive.
        }
        throw new HubSpotRequestError(method, path, res.status, reason);
      }
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    }
  };
}
