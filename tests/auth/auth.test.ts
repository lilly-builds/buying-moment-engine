import { describe, expect, it } from "vitest";
import {
  isAllowlisted,
  isPublicPath,
  parseAllowlist,
  requireSession,
} from "@/src/lib/auth";

describe("isPublicPath (R18)", () => {
  const PROD = true;
  const DEV = false;

  it("always leaves /login reachable, or the redirect loops", () => {
    for (const env of [PROD, DEV]) {
      expect(isPublicPath("/login", env)).toBe(true);
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

  it("opens /styleguide in dev for brand review", () => {
    expect(isPublicPath("/styleguide", DEV)).toBe(true);
  });

  it("KEEPS /styleguide behind auth in production", () => {
    // U2's styleguide reads nothing from the database, but R18 says the deployed
    // app serves no page to a non-allowlisted visitor. This is the line that
    // keeps the dev convenience from leaking into prod.
    expect(isPublicPath("/styleguide", PROD)).toBe(false);
  });

  it("does not open a path merely because it is prefixed by a public one", () => {
    expect(isPublicPath("/loginsomething", PROD)).toBe(false);
    expect(isPublicPath("/styleguide-secrets", DEV)).toBe(false);
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
