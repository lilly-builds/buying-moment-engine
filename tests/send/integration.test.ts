import { beforeEach, describe, expect, it } from "vitest";
import { storeConnection } from "@/db/crm";
import { createDbTokenProvider } from "@/src/crm/sync";
import { HUBSPOT_SEND_SCOPE } from "@/src/crm/hubspot-oauth";
import { encrypt } from "@/src/crm/token-crypto";
import { createHubSpotSender } from "@/src/send/hubspot-send";
import type { Recipient } from "@/src/send/adapter";
import type { OAuthHttpDeps } from "@/src/crm/hubspot-oauth";
import { createTestDb, type TestDb } from "../setup";
import { mockFetch } from "../crm/mock-fetch";

/**
 * Integration (U11): an EXPIRED HubSpot access token triggers exactly one refresh
 * and the send proceeds with the fresh token. Exercises the real seam — the send
 * binding + the proactively-refreshing DB token provider + PGlite — that U10
 * built and U11 reuses, against a mocked HubSpot (no live account; live smoke is
 * U15).
 */

const KEY = Buffer.alloc(32, 7);
const PORTAL = "portal_1";

function oauthDeps(fetchImpl: typeof fetch): OAuthHttpDeps {
  return {
    fetch: fetchImpl,
    clientId: "cid",
    clientSecret: "csecret-never-leak",
    redirectUri: "https://app.example.com/cb",
    baseUrl: "https://api.hubapi.test",
  };
}

/** HubSpot mock: refresh endpoint + the send surface. */
function mock() {
  return mockFetch((call) => {
    const { method, path } = call;
    if (method === "POST" && path === "/oauth/v1/token") {
      return { body: { access_token: "at_fresh", refresh_token: "rt_2", expires_in: 1800 } };
    }
    if (method === "POST" && path.startsWith("/crm/v3/properties/contacts")) {
      return { status: 201, body: {} };
    }
    if (method === "PATCH" && path.startsWith("/crm/v3/objects/contacts/")) {
      return { status: 200, body: { id: path.split("/").pop() } };
    }
    if (method === "POST" && path.endsWith("/enrollments")) {
      return { status: 201, body: { enrollmentId: "enr_1" } };
    }
    return { status: 404, body: { path } };
  });
}

describe("send with an expired access token", () => {
  let tdb: TestDb;
  beforeEach(async () => {
    tdb = await createTestDb();
  });

  it("refreshes exactly once, then enrolls with the fresh token", async () => {
    // A connection whose access token expired an hour ago → proactive refresh fires.
    await storeConnection(tdb.db, {
      provider: "hubspot",
      portalId: PORTAL,
      accessTokenEnc: encrypt("at_stale", KEY),
      refreshTokenEnc: encrypt("rt_1", KEY),
      expiresAt: new Date(Date.now() - 60 * 60 * 1000),
      scopes: `crm.objects.contacts.write ${HUBSPOT_SEND_SCOPE}`,
    });

    const { fetch: f, calls } = mock();
    const getAccessToken = createDbTokenProvider(tdb.db, oauthDeps(f), {
      portalId: PORTAL,
      encryptionKey: KEY,
    });

    const sender = createHubSpotSender({
      fetch: f,
      getAccessToken,
      baseUrl: "https://api.hubapi.test",
      sequenceId: "seq_1",
      senderEmail: "rep@sandbox.test",
      userId: "user_1",
      sandbox: { allowedDomains: ["sandbox.test"] },
    });

    const recipient: Recipient = {
      contactId: "ct_1",
      email: "qa@sandbox.test",
      classification: "sandbox",
    };
    const result = await sender.sendTouch({ recipient, touchNumber: 1, subject: "hi", body: "hello" });
    expect(result.enrolled).toBe(true);

    // Exactly ONE refresh, despite several HubSpot calls that all needed a token.
    const refreshes = calls.filter((c) => c.path === "/oauth/v1/token");
    expect(refreshes).toHaveLength(1);

    // The enrollment went out on the FRESH token, not the stale one.
    const enroll = calls.find((c) => c.path.endsWith("/enrollments"));
    expect(enroll?.authorization).toBe("Bearer at_fresh");
  });
});
