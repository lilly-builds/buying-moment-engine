import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../setup";
import { loadConnection } from "@/db/crm";
import {
  buildConnectHandshake,
  handleHubSpotCallback,
} from "@/src/crm/oauth-flow";
import {
  deriveSigningKey,
  makeStateCookieValue,
  verifyStateCookie,
} from "@/src/crm/oauth-state";
import type { OAuthHttpDeps } from "@/src/crm/hubspot-oauth";
import { hubspotConnectMock, mockFetch } from "./mock-fetch";

const ENC_KEY = Buffer.alloc(32, 11);
const SIGNING_KEY = deriveSigningKey(ENC_KEY);

function oauthDeps(fetchImpl: typeof fetch): OAuthHttpDeps {
  return {
    fetch: fetchImpl,
    clientId: "cid",
    clientSecret: "csecret",
    redirectUri: "https://app.example.com/api/hubspot/oauth",
    baseUrl: "https://api.hubapi.test",
  };
}

/** Token exchange + token-meta + the property-provisioning routes connect calls. */
function connectMock() {
  return hubspotConnectMock();
}

describe("buildConnectHandshake (initiation)", () => {
  it("mints an authorize URL carrying the state + a cookie that verifies it", () => {
    const { location, state, cookieValue } = buildConnectHandshake(
      oauthDeps(connectMock().fetch),
      SIGNING_KEY,
    );
    const u = new URL(location);
    expect(u.origin + u.pathname).toBe("https://app.hubspot.com/oauth/authorize");
    expect(u.searchParams.get("state")).toBe(state);
    // The send scope rides `optional_scope` so a free portal can still install.
    expect(u.searchParams.get("optional_scope")).toContain(
      "automation.sequences.enrollments.write",
    );
    expect(u.searchParams.get("scope")).toContain("crm.objects.deals.write");
    // the cookie is signed and validates against the same state
    expect(verifyStateCookie(cookieValue, state, SIGNING_KEY)).toBe(true);
  });
});

describe("handleHubSpotCallback (anti-CSRF + exchange)", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  const goodState = "a".repeat(64);
  const goodCookie = () => makeStateCookieValue(goodState, SIGNING_KEY);
  const baseArgs = () => ({
    code: "the-code",
    error: null as string | null,
    state: goodState,
    stateCookie: goodCookie(),
    encryptionKey: ENC_KEY,
    signingKey: SIGNING_KEY,
    now: () => new Date("2026-07-07T00:00:00Z"),
  });

  it("rejects a MISSING state (no cookie) with 400 and does NOT exchange", async () => {
    const mock = connectMock();
    const res = await handleHubSpotCallback(t.db, oauthDeps(mock.fetch), {
      ...baseArgs(),
      state: null,
      stateCookie: null,
    });
    expect(res).toEqual({ ok: false, status: 400, error: "Invalid or missing OAuth state" });
    expect(mock.calls).toHaveLength(0); // never hit the token endpoint
    expect(await loadConnection(t.db, "424242")).toBeNull();
  });

  it("rejects a MISMATCHED state with 400 and does NOT exchange", async () => {
    const mock = connectMock();
    const res = await handleHubSpotCallback(t.db, oauthDeps(mock.fetch), {
      ...baseArgs(),
      state: "b".repeat(64), // echoed state != cookie's state
    });
    expect(res.ok).toBe(false);
    expect((res as { status: number }).status).toBe(400);
    expect(mock.calls).toHaveLength(0);
  });

  it("rejects when ?error is present with 400", async () => {
    const mock = connectMock();
    const res = await handleHubSpotCallback(t.db, oauthDeps(mock.fetch), {
      ...baseArgs(),
      error: "access_denied",
    });
    expect((res as { status: number }).status).toBe(400);
    expect(mock.calls).toHaveLength(0);
  });

  it("accepts a MATCHING state + code → exchanges and stores tokens ENCRYPTED", async () => {
    const mock = connectMock();
    const res = await handleHubSpotCallback(t.db, oauthDeps(mock.fetch), baseArgs());
    expect(res).toEqual({
      ok: true,
      portalId: "424242",
      scopes: "oauth crm.objects.deals.write",
    });
    const row = await loadConnection(t.db, "424242");
    expect(row).not.toBeNull();
    expect(row!.accessTokenEnc).not.toContain("at_live"); // ciphertext at rest
  });

  it("maps a failed exchange to 502 without leaking anything", async () => {
    const failing = mockFetch((call) =>
      call.path === "/oauth/v1/token"
        ? { status: 500, body: { message: "csecret must not leak" } }
        : { status: 404, body: {} },
    );
    const res = await handleHubSpotCallback(t.db, oauthDeps(failing.fetch), baseArgs());
    expect(res).toEqual({ ok: false, status: 502, error: "HubSpot connect failed" });
  });
});
