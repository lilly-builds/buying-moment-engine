import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * OAuth `state` / anti-CSRF primitive (R8, R18, U10 hardening). The callback is
 * session-gated, but session-gating alone does not bind a callback to the
 * connect flow the SAME user actually started — that gap is authorization-code
 * CSRF/injection. This module implements the standard `state` defense, kept
 * STATELESS (no DB): a random state travels in the authorize URL AND in a
 * signed, httpOnly, SameSite=Lax cookie; the callback accepts the code only if
 * the `?state` matches the cookie (constant-time) and the cookie's HMAC verifies.
 *
 * PURE (key as a param) so it unit-tests with no env, no I/O.
 */

/** Name of the short-lived state cookie set at connect-initiation. */
export const STATE_COOKIE = "hs_oauth_state";

/** Cookie lifetime — the connect handshake is a few seconds; 10 min is ample. */
export const STATE_COOKIE_MAX_AGE_SECONDS = 600;

/** Cryptographically-random opaque state token (64 hex chars). */
export function generateState(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Derive a dedicated signing key from the app's token-encryption key via HKDF-
 * style HMAC, so the cookie-signing key is domain-separated from the key that
 * encrypts tokens at rest (never reuse one key for two purposes).
 */
export function deriveSigningKey(encryptionKey: Buffer): Buffer {
  return createHmac("sha256", encryptionKey)
    .update("hubspot-oauth-state-v1")
    .digest();
}

function sign(state: string, signingKey: Buffer): string {
  return createHmac("sha256", signingKey).update(state).digest("hex");
}

/** The cookie value: `state.hmac`. The signature makes the cookie tamper-evident. */
export function makeStateCookieValue(state: string, signingKey: Buffer): string {
  return `${state}.${sign(state, signingKey)}`;
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify the callback: the signed cookie is authentic AND its state matches the
 * `?state` echoed back by HubSpot. Returns false (never throws) on any missing
 * part, a signature mismatch, or a state mismatch — the route maps false -> 400.
 */
export function verifyStateCookie(
  cookieValue: string | null | undefined,
  queryState: string | null | undefined,
  signingKey: Buffer,
): boolean {
  if (!cookieValue || !queryState) return false;
  const dot = cookieValue.lastIndexOf(".");
  if (dot <= 0) return false;
  const state = cookieValue.slice(0, dot);
  const signature = cookieValue.slice(dot + 1);
  if (!state || !signature) return false;
  // Signature must be authentic AND the echoed state must match the cookie's.
  if (!constantTimeEqual(signature, sign(state, signingKey))) return false;
  return constantTimeEqual(state, queryState);
}
