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

/**
 * Scopes that MUST be granted for the app to install at all. Every one of these
 * is available on a free HubSpot portal (verified live 2026-07-08 — the free
 * portal 246702075 granted all eleven).
 *
 * `crm.schemas.*.write` is here because `ensureLeadProperties` creates the four
 * tag properties at connect time; without it that call 403s (`MISSING_SCOPES`).
 */
export const HUBSPOT_REQUIRED_SCOPES = [
  "oauth",
  "crm.objects.companies.read",
  "crm.objects.companies.write",
  "crm.objects.contacts.read",
  "crm.objects.contacts.write",
  "crm.objects.deals.read",
  "crm.objects.deals.write",
  "crm.schemas.companies.read",
  "crm.schemas.companies.write",
  "crm.schemas.deals.read",
  "crm.schemas.deals.write",
] as const;

/** The one scope the send path (U11) needs — Sequences enrollment. */
export const HUBSPOT_SEND_SCOPE = "automation.sequences.enrollments.write";

/**
 * Scopes requested but NOT required to install.
 *
 * WHY OPTIONAL: HubSpot Sequences is a Sales Hub Professional+ feature. Verified
 * live 2026-07-08 — with this scope marked *required*, a free portal refuses the
 * install outright: "Authorization failed because your account lacks access to
 * the required scopes [automation.sequences.enrollments.write]", which would take
 * the CRM push (the whole measured-ROI backbone) down with it. As an OPTIONAL
 * scope the same portal installs cleanly and simply isn't granted it, so CRM
 * works everywhere and only SEND self-gates — exactly D14's "full value before a
 * single key". Optional scopes ride the `optional_scope` query param.
 */
export const HUBSPOT_OPTIONAL_SCOPES = [HUBSPOT_SEND_SCOPE] as const;

/**
 * The full set the authorize URL asks for. Kept for callers that just want to
 * know everything the app may hold; the install-blocking set is REQUIRED only.
 */
export const HUBSPOT_SCOPES = [
  ...HUBSPOT_REQUIRED_SCOPES,
  ...HUBSPOT_OPTIONAL_SCOPES,
] as const;

/**
 * Can this connection send? Reads the scopes actually GRANTED (persisted on
 * `crm_connections.scopes` at connect time), never what we asked for — a portal
 * without Sales Hub Pro silently drops the optional send scope, and the U9/U11
 * send-gate must render that honestly rather than attempt a call that 403s.
 */
export function hasSendScope(
  grantedScopes: string | readonly string[] | null | undefined,
): boolean {
  if (!grantedScopes) return false;
  const list =
    typeof grantedScopes === "string"
      ? grantedScopes.split(/\s+/).filter(Boolean)
      : grantedScopes;
  return list.includes(HUBSPOT_SEND_SCOPE);
}

export const HUBSPOT_API_BASE = "https://api.hubapi.com";
export const HUBSPOT_AUTHORIZE_BASE = "https://app.hubspot.com/oauth/authorize";

/** Refresh this many ms BEFORE the token actually expires (clock-skew guard). */
export const DEFAULT_REFRESH_SKEW_MS = 5 * 60 * 1000;

/** Bounded network timeout — a stalled OAuth token response must not hang the live route. */
export const HUBSPOT_FETCH_TIMEOUT_MS = 15_000;

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

/**
 * Build the HubSpot authorize URL the "Connect HubSpot" button points at.
 *
 * `scope` carries the install-blocking set; `optional_scope` carries scopes a
 * portal may lack without failing the install (HubSpot's own split — putting an
 * optional scope in `scope` makes it required again and breaks free portals).
 */
export function buildAuthorizeUrl(args: {
  clientId: string;
  redirectUri: string;
  scopes?: readonly string[];
  optionalScopes?: readonly string[];
  state?: string;
}): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    scope: (args.scopes ?? HUBSPOT_REQUIRED_SCOPES).join(" "),
  });
  const optional = args.optionalScopes ?? HUBSPOT_OPTIONAL_SCOPES;
  if (optional.length > 0) params.set("optional_scope", optional.join(" "));
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
    signal: AbortSignal.timeout(HUBSPOT_FETCH_TIMEOUT_MS),
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
    { signal: AbortSignal.timeout(HUBSPOT_FETCH_TIMEOUT_MS) },
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
