import { NextResponse, type NextRequest } from "next/server";
import { guardMutation } from "@/src/lib/auth-guard";
import { getDb } from "@/db/client";
import { readEncryptionKey, readOAuthDeps } from "@/src/crm/config";
import { handleHubSpotCallback } from "@/src/crm/oauth-flow";
import { deriveSigningKey, STATE_COOKIE } from "@/src/crm/oauth-state";

// node:crypto (token encryption + state HMAC) — pin the Node runtime.
export const runtime = "nodejs";

/**
 * HubSpot "Connect" OAuth callback (R8, R18, U10). HubSpot redirects the
 * allowlisted user's browser here with `?code` + `?state`; we verify the state
 * against the signed cookie set at initiation (anti-CSRF), exchange the code,
 * and store the per-tenant tokens ENCRYPTED. Session-gated (R18): only a
 * logged-in, allowlisted user can connect a CRM.
 */
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
    return NextResponse.json({ error: "CRM not configured" }, { status: 503 });
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

  const res = result.ok
    ? NextResponse.json({
        ok: true,
        provider: "hubspot",
        portalId: result.portalId,
        scopes: result.scopes,
      })
    : NextResponse.json({ error: result.error }, { status: result.status });
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
