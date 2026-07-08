import type { Database } from "@/db/types";
import {
  buildAuthorizeUrl,
  type OAuthConfig,
  type OAuthHttpDeps,
} from "./hubspot-oauth";
import {
  generateState,
  makeStateCookieValue,
  verifyStateCookie,
} from "./oauth-state";
import { completeHubSpotConnect } from "./sync";

/**
 * OAuth connect handshake (R8, R18, U10 hardening) — the two secure halves of
 * the "Connect HubSpot" flow, extracted so the routes stay thin and the security
 * logic is unit-testable with no env/session mocking.
 *
 *   1. buildConnectHandshake — mints a `state`, the authorize URL carrying it,
 *      and the signed cookie value to set on the initiation response.
 *   2. handleHubSpotCallback — session-gating is the route's job; THIS enforces
 *      the anti-CSRF `state` check, then runs the (already-tested) code exchange
 *      + encrypted per-tenant store. Returns a status so the route just maps it.
 */

export interface ConnectHandshake {
  /** The HubSpot authorize URL to redirect the user to (carries `state`). */
  location: string;
  /** The raw state (mostly for tests/logging of non-secret value). */
  state: string;
  /** The signed value to set in the httpOnly state cookie. */
  cookieValue: string;
}

export function buildConnectHandshake(
  config: OAuthConfig,
  signingKey: Buffer,
): ConnectHandshake {
  const state = generateState();
  const location = buildAuthorizeUrl({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    state,
  });
  return { location, state, cookieValue: makeStateCookieValue(state, signingKey) };
}

export interface CallbackArgs {
  code: string | null;
  error: string | null;
  state: string | null;
  stateCookie: string | null;
  encryptionKey: Buffer;
  signingKey: Buffer;
  now?: () => Date;
}

export type CallbackResult =
  | { ok: true; portalId: string; scopes: string }
  | { ok: false; status: number; error: string };

export async function handleHubSpotCallback(
  db: Database,
  deps: OAuthHttpDeps,
  args: CallbackArgs,
): Promise<CallbackResult> {
  if (args.error) {
    return { ok: false, status: 400, error: "HubSpot authorization was denied" };
  }
  if (!args.code) {
    return { ok: false, status: 400, error: "Missing ?code" };
  }
  // Anti-CSRF: the callback must correspond to THIS user's initiation.
  if (!verifyStateCookie(args.stateCookie, args.state, args.signingKey)) {
    return { ok: false, status: 400, error: "Invalid or missing OAuth state" };
  }
  try {
    const { portalId, scopes } = await completeHubSpotConnect(db, deps, {
      code: args.code,
      encryptionKey: args.encryptionKey,
      now: args.now,
    });
    return { ok: true, portalId, scopes };
  } catch {
    // Never surface the underlying error — it can echo tokens/secrets (D9).
    return { ok: false, status: 502, error: "HubSpot connect failed" };
  }
}
