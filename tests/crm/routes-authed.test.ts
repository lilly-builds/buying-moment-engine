import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the session gate to an authenticated, allowlisted user so we can exercise
// the REAL route wiring past the 401 gate (fail-closed 401s live in routes.test.ts).
vi.mock("@/src/lib/auth-guard", () => ({
  guardMutation: vi.fn(async () => ({ ok: true, email: "lilly@opterraventures.com" })),
}));

import { GET as hubspotOAuthStartGET } from "@/app/api/hubspot/oauth/start/route";
import {
  deriveSigningKey,
  STATE_COOKIE,
  verifyStateCookie,
} from "@/src/crm/oauth-state";
import { normalizeKey } from "@/src/crm/token-crypto";

const ENC_KEY_B64 = Buffer.alloc(32, 3).toString("base64");

describe("HubSpot OAuth initiation route (authenticated)", () => {
  beforeEach(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", ENC_KEY_B64);
    vi.stubEnv("HUBSPOT_CLIENT_ID", "client-abc");
    vi.stubEnv("HUBSPOT_CLIENT_SECRET", "secret-xyz");
    vi.stubEnv("HUBSPOT_REDIRECT_URI", "https://app.example.com/api/hubspot/oauth");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("redirects to HubSpot authorize and sets a signed httpOnly state cookie matching the URL state", async () => {
    const res = await hubspotOAuthStartGET();

    // redirect to the HubSpot authorize page carrying a state
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    const url = new URL(location);
    expect(url.origin + url.pathname).toBe("https://app.hubspot.com/oauth/authorize");
    const urlState = url.searchParams.get("state");
    expect(urlState).toMatch(/^[0-9a-f]{64}$/);

    // the state cookie is set, httpOnly, and its signed value verifies the URL state
    const cookie = res.cookies.get(STATE_COOKIE);
    expect(cookie).toBeDefined();
    expect(cookie!.httpOnly).toBe(true);
    expect(cookie!.sameSite).toBe("lax");
    const signingKey = deriveSigningKey(normalizeKey(ENC_KEY_B64));
    expect(verifyStateCookie(cookie!.value, urlState, signingKey)).toBe(true);
  });

  it("returns 503 when the CRM env is not configured", async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
    const res = await hubspotOAuthStartGET();
    expect(res.status).toBe(503);
  });
});
