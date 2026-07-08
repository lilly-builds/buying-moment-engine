/**
 * HubSpot OAuth 2.0 — authorization-code flow for an internal/unverified app
 * (R8, U10). ONE "Connect HubSpot" grant covers CRM objects + Sequences
 * enrollment (send, U11's problem — just don't design it out) + open/click/reply
 * analytics. Access token ~30 min, refreshed PROACTIVELY off `expires_in`;
 * refresh token long-lived.
 *
 * PURE timing/URL helpers are separated from the token-endpoint I/O so the
 * refresh-timing decision unit-tests with no HTTP. All HTTP goes through an
 * injected `fetch` so tests mock it (no live HubSpot account needed — U15).
 */

/** The scopes requested on the single grant (send + analytics ride along). */
export const HUBSPOT_SCOPES = [
  "oauth",
  "crm.objects.companies.read",
  "crm.objects.companies.write",
  "crm.objects.contacts.read",
  "crm.objects.contacts.write",
  "crm.objects.deals.read",
  "crm.objects.deals.write",
  // Send (U11) — must be on the SAME grant so one connect covers it (R8).
  "automation.sequences.enrollments.write",
] as const;

export const HUBSPOT_API_BASE = "https://api.hubapi.com";
export const HUBSPOT_AUTHORIZE_BASE = "https://app.hubspot.com/oauth/authorize";

/** Refresh this many ms BEFORE the token actually expires (clock-skew guard). */
export const DEFAULT_REFRESH_SKEW_MS = 5 * 60 * 1000;

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires (HubSpot `expires_in`). */
  expiresIn: number;
}

export interface TokenMeta {
  /** HubSpot portal/hub id — the per-tenant key. */
  hubId: string;
  scopes: string[];
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface OAuthHttpDeps extends OAuthConfig {
  fetch: typeof fetch;
  /** Override for tests; defaults to the real HubSpot API base. */
  baseUrl?: string;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** Build the HubSpot authorize URL the "Connect HubSpot" button points at. */
export function buildAuthorizeUrl(args: {
  clientId: string;
  redirectUri: string;
  scopes?: readonly string[];
  state?: string;
}): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    scope: (args.scopes ?? HUBSPOT_SCOPES).join(" "),
  });
  if (args.state) params.set("state", args.state);
  return `${HUBSPOT_AUTHORIZE_BASE}?${params.toString()}`;
}

/** Absolute expiry instant from HubSpot's relative `expires_in` (seconds). */
export function expiresAtFromExpiresIn(expiresIn: number, now: Date): Date {
  return new Date(now.getTime() + expiresIn * 1000);
}

/**
 * Proactive-refresh decision (pure). True once we are within the skew window of
 * expiry — so we refresh a little early rather than risk a call with a
 * just-expired token.
 */
export function shouldRefresh(
  expiresAt: Date,
  now: Date,
  skewMs: number = DEFAULT_REFRESH_SKEW_MS,
): boolean {
  return now.getTime() >= expiresAt.getTime() - skewMs;
}

// ── Token-endpoint I/O (injected fetch) ──────────────────────────────────────

function baseOf(deps: OAuthHttpDeps): string {
  return deps.baseUrl ?? HUBSPOT_API_BASE;
}

interface RawTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function postTokenForm(
  deps: OAuthHttpDeps,
  form: Record<string, string>,
): Promise<TokenSet> {
  const res = await deps.fetch(`${baseOf(deps)}/oauth/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  if (!res.ok) {
    // Never surface the response body — it can echo the client secret.
    throw new Error(`HubSpot token endpoint failed with ${res.status}`);
  }
  const json = (await res.json()) as RawTokenResponse;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
  };
}

/** Exchange the `?code` from the callback for the first token set. */
export function exchangeCodeForTokens(
  deps: OAuthHttpDeps,
  code: string,
): Promise<TokenSet> {
  return postTokenForm(deps, {
    grant_type: "authorization_code",
    client_id: deps.clientId,
    client_secret: deps.clientSecret,
    redirect_uri: deps.redirectUri,
    code,
  });
}

/** Trade a refresh token for a fresh access token (proactive refresh). */
export function refreshAccessToken(
  deps: OAuthHttpDeps,
  refreshToken: string,
): Promise<TokenSet> {
  return postTokenForm(deps, {
    grant_type: "refresh_token",
    client_id: deps.clientId,
    client_secret: deps.clientSecret,
    refresh_token: refreshToken,
  });
}

/**
 * Look up the portal/hub id + granted scopes for an access token. HubSpot does
 * not return `hub_id` in the token exchange, so we read it from the token-meta
 * endpoint — this is the per-tenant key we store the connection under.
 */
export async function fetchTokenMeta(
  deps: OAuthHttpDeps,
  accessToken: string,
): Promise<TokenMeta> {
  const res = await deps.fetch(
    `${baseOf(deps)}/oauth/v1/access-tokens/${encodeURIComponent(accessToken)}`,
  );
  if (!res.ok) {
    throw new Error(`HubSpot token-meta lookup failed with ${res.status}`);
  }
  const json = (await res.json()) as { hub_id: number | string; scopes?: string[] };
  return {
    hubId: String(json.hub_id),
    scopes: json.scopes ?? [],
  };
}
