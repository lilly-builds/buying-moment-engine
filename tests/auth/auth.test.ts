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

  it("always leaves /login and the magic-link callback reachable, or the redirect loops", () => {
    for (const env of [PROD, DEV]) {
      expect(isPublicPath("/login", env)).toBe(true);
      // /auth/callback exchanges the OTP code for a session and re-checks the
      // allowlist itself — it must be reachable without a session because it is
      // how you get one. Public in prod too, where real logins happen.
      expect(isPublicPath("/auth/callback", env)).toBe(true);
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
});

describe("parseAllowlist / isAllowlisted", () => {
  const allowlist = parseAllowlist("User@Example.com, team@other.com");

  it("parses, trims, and lowercases", () => {
    expect(allowlist).toEqual(["user@example.com", "team@other.com"]);
  });
  it("matches case-insensitively", () => {
    expect(isAllowlisted("USER@example.com", allowlist)).toBe(true);
  });
  it("rejects a non-listed email", () => {
    expect(isAllowlisted("stranger@evil.com", allowlist)).toBe(false);
  });
  it("rejects empty / null email", () => {
    expect(isAllowlisted("", allowlist)).toBe(false);
    expect(isAllowlisted(null, allowlist)).toBe(false);
  });
  it("an empty allowlist fails closed", () => {
    expect(isAllowlisted("team@other.com", [])).toBe(false);
  });
});

describe("isAllowlisted — domain-rule allowlist (@domain)", () => {
  // Why this exists: when the exact addresses we must allow are format-guesses on a
  // catch-all domain, an exact-match miss silently locks a legitimate person out
  // (no bounce). A `@domain` entry admits anyone at that domain regardless of the
  // local-part spelling, without opening the gate to anyone else.
  const allowlist = parseAllowlist("@example.com, person@other.com");

  it("admits any local-part at the listed domain", () => {
    expect(isAllowlisted("user@example.com", allowlist)).toBe(true);
    expect(isAllowlisted("first.last@example.com", allowlist)).toBe(true);
    expect(isAllowlisted("someone.else@example.com", allowlist)).toBe(true);
  });

  it("still honors a plain exact entry alongside a domain rule", () => {
    expect(isAllowlisted("person@other.com", allowlist)).toBe(true);
    // an exact entry must NOT behave like a domain rule
    expect(isAllowlisted("stranger@other.com", allowlist)).toBe(false);
  });

  it("is case-insensitive for the domain match", () => {
    expect(isAllowlisted("First.Last@Example.com", allowlist)).toBe(true);
  });

  it("rejects a different domain", () => {
    expect(isAllowlisted("user@evil.com", allowlist)).toBe(false);
    expect(isAllowlisted("notanexample@gmail.com", allowlist)).toBe(false);
  });

  it("anchors on the full @domain — a look-alike suffix must NOT match", () => {
    // the classic bypass: append the allowed domain as a subdomain of an attacker host
    expect(isAllowlisted("user@example.com.evil.com", allowlist)).toBe(false);
    // a substring that isn't preceded by `@` must not match either
    expect(isAllowlisted("user@notexample.com", allowlist)).toBe(false);
    // a subdomain is a DIFFERENT domain, not the listed one
    expect(isAllowlisted("user@mail.example.com", allowlist)).toBe(false);
  });

  it("a bare @ or a dotless @entry is NOT a domain rule and matches nothing", () => {
    // `@` alone or `@com` must never become 'allow everyone at any/that TLD'
    expect(isAllowlisted("anyone@anywhere.com", parseAllowlist("@"))).toBe(false);
    expect(isAllowlisted("anyone@com", parseAllowlist("@com"))).toBe(false);
    expect(isAllowlisted("x@y.com", parseAllowlist("@com"))).toBe(false);
  });

  it("empty / whitespace entries match nothing (parse drops them)", () => {
    const parsed = parseAllowlist(" , @example.com ,  ");
    expect(parsed).toEqual(["@example.com"]);
    expect(isAllowlisted("user@example.com", parsed)).toBe(true);
  });
});

describe("requireSession", () => {
  const allowlist = parseAllowlist("team@other.com");

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
    const r = requireSession({ user: { email: "team@other.com" } }, allowlist);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.email).toBe("team@other.com");
  });
});
