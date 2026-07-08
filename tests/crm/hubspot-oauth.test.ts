import { describe, expect, it } from "vitest";
import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  expiresAtFromExpiresIn,
  fetchTokenMeta,
  HUBSPOT_SCOPES,
  refreshAccessToken,
  shouldRefresh,
  type OAuthHttpDeps,
} from "@/src/crm/hubspot-oauth";
import { mockFetch } from "./mock-fetch";

function depsWith(fetchImpl: typeof fetch): OAuthHttpDeps {
  return {
    fetch: fetchImpl,
    clientId: "client-123",
    clientSecret: "secret-should-never-leak",
    redirectUri: "https://app.example.com/api/hubspot/oauth",
    baseUrl: "https://api.hubapi.test",
  };
}

describe("hubspot-oauth pure helpers", () => {
  it("authorize URL carries client_id, redirect_uri, state, and the send scope", () => {
    const url = buildAuthorizeUrl({
      clientId: "client-123",
      redirectUri: "https://app.example.com/cb",
      state: "abc",
    });
    const u = new URL(url);
    expect(u.searchParams.get("client_id")).toBe("client-123");
    expect(u.searchParams.get("redirect_uri")).toBe("https://app.example.com/cb");
    expect(u.searchParams.get("state")).toBe("abc");
    // ONE grant must include the Sequences (send) scope (R8, U11 rides along).
    expect(u.searchParams.get("scope")).toContain(
      "automation.sequences.enrollments.write",
    );
    expect(HUBSPOT_SCOPES).toContain("crm.objects.deals.write");
  });

  it("expiresAtFromExpiresIn adds expires_in seconds to now", () => {
    const now = new Date("2026-07-07T00:00:00Z");
    const at = expiresAtFromExpiresIn(1800, now);
    expect(at.toISOString()).toBe("2026-07-07T00:30:00.000Z");
  });

  it("shouldRefresh is false well before expiry, true inside the skew window", () => {
    const now = new Date("2026-07-07T00:00:00Z");
    const farOff = new Date("2026-07-07T00:30:00Z");
    const soon = new Date("2026-07-07T00:04:00Z"); // < 5 min skew
    const past = new Date("2026-07-06T23:59:00Z");
    expect(shouldRefresh(farOff, now)).toBe(false);
    expect(shouldRefresh(soon, now)).toBe(true);
    expect(shouldRefresh(past, now)).toBe(true);
  });
});

describe("hubspot-oauth token endpoint I/O (mocked)", () => {
  it("exchangeCodeForTokens posts an authorization_code grant and maps the response", async () => {
    const { fetch: f, calls } = mockFetch(() => ({
      body: {
        access_token: "at_new",
        refresh_token: "rt_new",
        expires_in: 1800,
      },
    }));
    const tokens = await exchangeCodeForTokens(depsWith(f), "the-code");
    expect(tokens).toEqual({
      accessToken: "at_new",
      refreshToken: "rt_new",
      expiresIn: 1800,
    });
    const form = new URLSearchParams(String(calls[0].body));
    expect(calls[0].path).toBe("/oauth/v1/token");
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("the-code");
    expect(form.get("client_id")).toBe("client-123");
  });

  it("refreshAccessToken posts a refresh_token grant", async () => {
    const { fetch: f, calls } = mockFetch(() => ({
      body: { access_token: "at2", refresh_token: "rt2", expires_in: 1800 },
    }));
    const tokens = await refreshAccessToken(depsWith(f), "rt_old");
    expect(tokens.accessToken).toBe("at2");
    const form = new URLSearchParams(String(calls[0].body));
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("rt_old");
  });

  it("fetchTokenMeta returns the portal (hub) id + scopes", async () => {
    const { fetch: f } = mockFetch(() => ({
      body: { hub_id: 424242, scopes: ["oauth", "crm.objects.deals.write"] },
    }));
    const meta = await fetchTokenMeta(depsWith(f), "at_new");
    expect(meta.hubId).toBe("424242");
    expect(meta.scopes).toContain("crm.objects.deals.write");
  });

  it("throws WITHOUT echoing the response body (no secret leak) on a bad status", async () => {
    const { fetch: f } = mockFetch(() => ({
      status: 400,
      body: { message: "secret-should-never-leak in an error body" },
    }));
    await expect(exchangeCodeForTokens(depsWith(f), "bad")).rejects.toThrow(
      /token endpoint failed with 400/,
    );
    await expect(
      exchangeCodeForTokens(depsWith(f), "bad"),
    ).rejects.not.toThrow(/secret-should-never-leak/);
  });
});
