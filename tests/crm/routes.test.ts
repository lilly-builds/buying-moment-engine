import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as hubspotOAuthGET } from "@/app/api/hubspot/oauth/route";
import { GET as hubspotOAuthStartGET } from "@/app/api/hubspot/oauth/start/route";
import { POST as crmSyncPOST } from "@/app/api/crm-sync/route";

/**
 * The CRM mutation routes are session-gated (R18): an unauthenticated request is
 * rejected with 401 BEFORE any token exchange, state check, or DB write happens.
 * With no Supabase-Auth env configured, guardMutation fails closed. The state /
 * CSRF and connection-resolution logic is exercised in oauth-flow + sync tests.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("CRM routes reject an unauthenticated request", () => {
  it("HubSpot OAuth INITIATION GET -> 401 when not signed in", async () => {
    const res = await hubspotOAuthStartGET();
    expect(res.status).toBe(401);
  });

  it("HubSpot OAuth callback GET (with a code+state) -> 401 when not signed in", async () => {
    const req = new NextRequest(
      "http://localhost/api/hubspot/oauth?code=abc123&state=xyz",
    );
    const res = await hubspotOAuthGET(req);
    expect(res.status).toBe(401);
  });

  it("crm-sync POST -> 401 when not signed in (gate runs before body parse)", async () => {
    const req = new NextRequest("http://localhost/api/crm-sync", {
      method: "POST",
      body: JSON.stringify({ practiceId: "p", lead: {} }),
    });
    const res = await crmSyncPOST(req);
    expect(res.status).toBe(401);
  });
});
