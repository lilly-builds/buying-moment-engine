import { HUBSPOT_API_BASE, type OAuthHttpDeps } from "./hubspot-oauth";
import { normalizeKey } from "./token-crypto";

/**
 * Production env readers for the CRM routes (R8, U10). Kept out of the pure
 * modules so those stay env-free/testable. Each throws a NON-secret error when a
 * key is missing, so a route can answer 503 "not configured" without leaking any
 * value. NOTE: HUBSPOT_* + TOKEN_ENCRYPTION_KEY are empty until the live wire-up
 * (U15) — until then these throw and the routes report "CRM not configured".
 */

export function readEncryptionKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  return normalizeKey(raw);
}

export function readOAuthDeps(): OAuthHttpDeps {
  const clientId = process.env.HUBSPOT_CLIENT_ID;
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
  const redirectUri = process.env.HUBSPOT_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("HubSpot OAuth env is not fully configured");
  }
  return {
    fetch,
    clientId,
    clientSecret,
    redirectUri,
    baseUrl: HUBSPOT_API_BASE,
  };
}
