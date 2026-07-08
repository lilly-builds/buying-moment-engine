import { NextResponse, type NextRequest } from "next/server";
import { guardMutation } from "@/src/lib/auth-guard";
import { getDb } from "@/db/client";
import { readEncryptionKey, readOAuthDeps } from "@/src/crm/config";
import { completeHubSpotConnect } from "@/src/crm/sync";

// node:crypto (token encryption) — pin the Node runtime.
export const runtime = "nodejs";

/**
 * HubSpot "Connect" OAuth callback (R8, U10). HubSpot redirects the allowlisted
 * user's browser here with `?code`; we exchange it and store the per-tenant
 * tokens ENCRYPTED. Session-gated (R18): only a logged-in, allowlisted user can
 * connect a CRM. The single grant covers CRM + send + analytics.
 */
export async function GET(request: NextRequest) {
  const auth = await guardMutation();
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  const params = request.nextUrl.searchParams;
  if (params.get("error")) {
    return NextResponse.json(
      { error: "HubSpot authorization was denied" },
      { status: 400 },
    );
  }
  const code = params.get("code");
  if (!code) {
    return NextResponse.json({ error: "Missing ?code" }, { status: 400 });
  }

  let encryptionKey: Buffer;
  let deps;
  try {
    encryptionKey = readEncryptionKey();
    deps = readOAuthDeps();
  } catch {
    // Config absent (HUBSPOT_* / TOKEN_ENCRYPTION_KEY empty until U15).
    return NextResponse.json({ error: "CRM not configured" }, { status: 503 });
  }

  try {
    const { portalId, scopes } = await completeHubSpotConnect(getDb(), deps, {
      code,
      encryptionKey,
    });
    return NextResponse.json({ ok: true, provider: "hubspot", portalId, scopes });
  } catch {
    // Never surface the underlying error — it can echo tokens/secrets (D9).
    return NextResponse.json({ error: "HubSpot connect failed" }, { status: 502 });
  }
}
