import { describe, expect, it } from "vitest";
import {
  isAllowlisted,
  isPublicPath,
  isTenantAppPath,
  isTenantWorkspaceCookieValue,
  parseAllowlist,
  requireSession,
} from "@/src/lib/auth";

describe("isPublicPath (R18)", () => {
  const PROD = true;
  const DEV = false;

  it("always leaves /login and the magic-link callback reachable, or the redirect loops", () => {
    for (const env of [PROD, DEV]) {
      expect(isPublicPath("/login", env)).toBe(true);
      // /auth/callback exchanges the OTP code for a session and re-checks the
      // allowlist itself — it must be reachable without a session because it is
      // how you get one. Public in prod too, where real logins happen.
      expect(isPublicPath("/auth/callback", env)).toBe(true);
    }
  });

  it("opens the /welcome marketing front door in every environment", () => {
    // The SaaS shell's public landing (Adapt-It P5). It reads no database data, so
    // it is safe to serve to an anonymous visitor in production too — unlike the
    // dev-only visual surfaces below. Its CTAs still route through the gate.
    for (const env of [PROD, DEV]) {
      expect(isPublicPath("/welcome", env)).toBe(true);
    }
  });

  it("no longer exempts the enrich callback U5 deleted", () => {
    // The route is gone (PDL is synchronous — no inbound callback exists). A
    // lingering allowlist entry would silently ship the path unauthenticated if
    // anything ever re-added it. This test is the thing that notices.
    for (const env of [PROD, DEV]) {
      expect(isPublicPath("/api/enrich-callback", env)).toBe(false);
    }
  });

  it("gates the app itself in every environment", () => {
    for (const env of [PROD, DEV]) {
      expect(isPublicPath("/", env)).toBe(false);
      expect(isPublicPath("/practice/123", env)).toBe(false);
      expect(isPublicPath("/scoreboard", env)).toBe(false);
      expect(isPublicPath("/api/feedback", env)).toBe(false);
    }
  });

  it("opens /styleguide and /signals in dev for design review", () => {
    expect(isPublicPath("/styleguide", DEV)).toBe(true);
    expect(isPublicPath("/signals", DEV)).toBe(true);
  });

  it("KEEPS the dev-only visual surfaces behind auth in production", () => {
    // Neither reads the database, but R18 says the deployed app serves no page to
    // a non-allowlisted visitor. This is the line that keeps the dev convenience
    // from leaking into prod.
    expect(isPublicPath("/styleguide", PROD)).toBe(false);
    expect(isPublicPath("/signals", PROD)).toBe(false);
  });

  it("does not open a path merely because it is prefixed by a public one", () => {
    expect(isPublicPath("/loginsomething", PROD)).toBe(false);
    expect(isPublicPath("/auth/callbackevil", PROD)).toBe(false);
    expect(isPublicPath("/styleguide-secrets", DEV)).toBe(false);
  });

  it("opens /adapt and /api/adapt (onboarding + generate/finalize) in every environment", () => {
    // Onboarding precedes any session, so it — and the routes it calls to spend
    // Claude generating a workspace — must be reachable pre-auth.
    for (const env of [PROD, DEV]) {
      expect(isPublicPath("/adapt", env)).toBe(true);
      expect(isPublicPath("/adapt/anything", env)).toBe(true);
      expect(isPublicPath("/api/adapt", env)).toBe(true);
      expect(isPublicPath("/api/adapt/generate", env)).toBe(true);
    }
  });
});

describe("isTenantAppPath", () => {
  it("opens exactly the tenant-app route trees", () => {
    expect(isTenantAppPath("/")).toBe(true);
    expect(isTenantAppPath("/prospect/x")).toBe(true);
    expect(isTenantAppPath("/customize")).toBe(true);
    expect(isTenantAppPath("/scoreboard")).toBe(true);
    expect(isTenantAppPath("/api/workspace/update")).toBe(true);
  });

  it("excludes /practice (real data) and unrelated routes", () => {
    expect(isTenantAppPath("/practice/x")).toBe(false);
    expect(isTenantAppPath("/integrations")).toBe(false);
    expect(isTenantAppPath("/random")).toBe(false);
  });
});

describe("isTenantWorkspaceCookieValue", () => {
  it("accepts a genuine tenant slug", () => {
    expect(isTenantWorkspaceCookieValue("acme-corp")).toBe(true);
  });

  it("rejects missing/empty values and the two default-workspace slugs", () => {
    expect(isTenantWorkspaceCookieValue(undefined)).toBe(false);
    expect(isTenantWorkspaceCookieValue("")).toBe(false);
    expect(isTenantWorkspaceCookieValue("default")).toBe(false);
    expect(isTenantWorkspaceCookieValue("eliseai")).toBe(false);
  });
});

describe("parseAllowlist / isAllowlisted", () => {
  const allowlist = parseAllowlist("Lilly@Opterra.com, ae@eliseai.com");

  it("parses, trims, and lowercases", () => {
    expect(allowlist).toEqual(["lilly@opterra.com", "ae@eliseai.com"]);
  });
  it("matches case-insensitively", () => {
    expect(isAllowlisted("LILLY@opterra.com", allowlist)).toBe(true);
  });
  it("rejects a non-listed email", () => {
    expect(isAllowlisted("stranger@evil.com", allowlist)).toBe(false);
  });
  it("rejects empty / null email", () => {
    expect(isAllowlisted("", allowlist)).toBe(false);
    expect(isAllowlisted(null, allowlist)).toBe(false);
  });
  it("an empty allowlist fails closed", () => {
    expect(isAllowlisted("ae@eliseai.com", [])).toBe(false);
  });
});

describe("requireSession", () => {
  const allowlist = parseAllowlist("ae@eliseai.com");

  it("401 when the session is absent", () => {
    const r = requireSession(null, allowlist);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });
  it("401 when the email is not allowlisted", () => {
    const r = requireSession({ user: { email: "x@y.com" } }, allowlist);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });
  it("ok when the session email is allowlisted", () => {
    const r = requireSession({ user: { email: "ae@eliseai.com" } }, allowlist);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.email).toBe("ae@eliseai.com");
  });
});
