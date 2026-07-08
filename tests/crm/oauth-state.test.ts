import { describe, expect, it } from "vitest";
import {
  deriveSigningKey,
  generateState,
  makeStateCookieValue,
  verifyStateCookie,
} from "@/src/crm/oauth-state";

const ENC_KEY = Buffer.alloc(32, 7);
const SIGNING_KEY = deriveSigningKey(ENC_KEY);

describe("oauth-state (anti-CSRF)", () => {
  it("generateState is random and 64 hex chars", () => {
    const a = generateState();
    const b = generateState();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it("deriveSigningKey is deterministic and domain-separated from the enc key", () => {
    expect(deriveSigningKey(ENC_KEY).equals(SIGNING_KEY)).toBe(true);
    expect(SIGNING_KEY.equals(ENC_KEY)).toBe(false);
    expect(deriveSigningKey(Buffer.alloc(32, 9)).equals(SIGNING_KEY)).toBe(false);
  });

  it("accepts a matching signed cookie + echoed state", () => {
    const state = generateState();
    const cookie = makeStateCookieValue(state, SIGNING_KEY);
    expect(verifyStateCookie(cookie, state, SIGNING_KEY)).toBe(true);
  });

  it("rejects a missing cookie or missing query state", () => {
    const state = generateState();
    const cookie = makeStateCookieValue(state, SIGNING_KEY);
    expect(verifyStateCookie(null, state, SIGNING_KEY)).toBe(false);
    expect(verifyStateCookie(cookie, null, SIGNING_KEY)).toBe(false);
    expect(verifyStateCookie("", "", SIGNING_KEY)).toBe(false);
  });

  it("rejects a mismatched echoed state (CSRF: attacker's code, victim's cookie)", () => {
    const state = generateState();
    const cookie = makeStateCookieValue(state, SIGNING_KEY);
    expect(verifyStateCookie(cookie, generateState(), SIGNING_KEY)).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const state = generateState();
    const cookie = makeStateCookieValue(state, SIGNING_KEY);
    const [s, sig] = cookie.split(".");
    const flipped = sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0");
    expect(verifyStateCookie(`${s}.${flipped}`, state, SIGNING_KEY)).toBe(false);
  });

  it("rejects a swapped state whose signature no longer matches", () => {
    const state = generateState();
    const cookie = makeStateCookieValue(state, SIGNING_KEY);
    const evil = generateState();
    // attacker keeps the victim's signature but swaps in their own state
    const forged = `${evil}.${cookie.split(".")[1]}`;
    expect(verifyStateCookie(forged, evil, SIGNING_KEY)).toBe(false);
  });

  it("rejects a cookie signed with a different key", () => {
    const state = generateState();
    const cookie = makeStateCookieValue(state, deriveSigningKey(Buffer.alloc(32, 1)));
    expect(verifyStateCookie(cookie, state, SIGNING_KEY)).toBe(false);
  });

  it("rejects a malformed cookie (no signature part)", () => {
    expect(verifyStateCookie("justastate", "justastate", SIGNING_KEY)).toBe(false);
  });
});
