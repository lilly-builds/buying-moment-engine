import { NextResponse, type NextRequest } from "next/server";
import { guardMutation } from "@/src/lib/auth-guard";
import { getDb } from "@/db/client";
import { readEncryptionKey, readOAuthDeps } from "@/src/crm/config";
import { handleHubSpotCallback } from "@/src/crm/oauth-flow";
import { deriveSigningKey, STATE_COOKIE } from "@/src/crm/oauth-state";

// node:crypto (token encryption + state HMAC) — pin the Node runtime.
export const runtime = "nodejs";

/**
 * HubSpot "Connect" OAuth callback (R8, R18, U10, U17). HubSpot redirects the
 * allowlisted user's browser here with `?code` + `?state`; we verify the state
 * against the signed cookie set at initiation (anti-CSRF), exchange the code,
 * and store the per-tenant tokens ENCRYPTED. Session-gated (R18): only a
 * logged-in, allowlisted user can connect a CRM.
 *
 * This is a BROWSER redirect target, not an API fetch — so every outcome lands
 * the user back on the Connections page (`/integrations`) with a status the page
 * renders as a banner, rather than showing them raw JSON. No secret ever rides
 * the query string; `?error` carries a stable, non-sensitive code.
 */

/** Land the user back on the Connections page with a readable status. */
function backToConnections(
  request: NextRequest,
  status: "connected" | { error: string },
): NextResponse {
  // Use the configured callback origin as the canonical app host. In production,
  // Vercel can serve the same route from multiple aliases, and HubSpot may briefly
  // bounce through its own post-install pages. The browser should always land back
  // on the public app URL after the token is saved.
  const origin = process.env.HUBSPOT_REDIRECT_URI
    ? new URL(process.env.HUBSPOT_REDIRECT_URI).origin
    : request.nextUrl.origin;
  const url = new URL("/integrations", origin);
  if (status === "connected") url.searchParams.set("connected", "hubspot");
  else url.searchParams.set("error", status.error);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const auth = await guardMutation();
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  let encryptionKey: Buffer;
  let deps;
  try {
    encryptionKey = readEncryptionKey();
    deps = readOAuthDeps();
  } catch {
    // Config absent (HUBSPOT_* / TOKEN_ENCRYPTION_KEY empty until U15).
    return backToConnections(request, { error: "not_configured" });
  }

  const params = request.nextUrl.searchParams;
  const result = await handleHubSpotCallback(getDb(), deps, {
    code: params.get("code"),
    error: params.get("error"),
    state: params.get("state"),
    stateCookie: request.cookies.get(STATE_COOKIE)?.value ?? null,
    encryptionKey,
    signingKey: deriveSigningKey(encryptionKey),
  });

  if (!result.ok) {
    console.warn("HubSpot OAuth callback returned a failed result", {
      status: result.status,
      error: result.error,
      hasCode: Boolean(params.get("code")),
      hasState: Boolean(params.get("state")),
      hasStateCookie: Boolean(request.cookies.get(STATE_COOKIE)?.value),
    });
  }

  const res = result.ok
    ? backToConnections(request, "connected")
    : backToConnections(request, { error: "connect_failed" });
  // Single-use handshake: clear the state cookie on every outcome.
  res.cookies.set(STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/api/hubspot",
    maxAge: 0,
  });
  return res;
}
