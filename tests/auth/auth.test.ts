import { describe, expect, it } from "vitest";
import { isAllowlisted, parseAllowlist, requireSession } from "@/src/lib/auth";

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
