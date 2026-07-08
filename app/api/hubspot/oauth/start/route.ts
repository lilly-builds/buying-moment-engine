import { NextResponse } from "next/server";
import { guardMutation } from "@/src/lib/auth-guard";
import { readEncryptionKey, readOAuthDeps } from "@/src/crm/config";
import { buildConnectHandshake } from "@/src/crm/oauth-flow";
import {
  deriveSigningKey,
  STATE_COOKIE,
  STATE_COOKIE_MAX_AGE_SECONDS,
} from "@/src/crm/oauth-state";

// node:crypto (random state + state HMAC) — pin the Node runtime.
export const runtime = "nodejs";

/**
 * HubSpot "Connect" INITIATION (R8, R18, U10). Session-gated: only a logged-in,
 * allowlisted user can start a connect. Mints a random anti-CSRF `state`, sets
 * it in a signed httpOnly SameSite=Lax short-lived cookie, and redirects the
 * user to HubSpot's authorize page carrying that same state. The callback later
 * verifies the two match. This is the secure handshake only — the Connections UI
 * that links to this route is U17.
 */
export async function GET() {
  const auth = await guardMutation();
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  let encryptionKey: Buffer;
  let deps;
  try {
    encryptionKey = readEncryptionKey();
    deps = readOAuthDeps();
  } catch {
    return NextResponse.json({ error: "CRM not configured" }, { status: 503 });
  }

  const { location, cookieValue } = buildConnectHandshake(
    deps,
    deriveSigningKey(encryptionKey),
  );

  const res = NextResponse.redirect(location);
  res.cookies.set(STATE_COOKIE, cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/api/hubspot",
    maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
  });
  return res;
}
