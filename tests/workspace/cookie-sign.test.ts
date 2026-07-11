import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  signWorkspaceCookie,
  verifyWorkspaceCookie,
} from "@/src/workspace/cookie-sign";

const KEY = "TOKEN_ENCRYPTION_KEY";
const original = process.env[KEY];

beforeEach(() => {
  process.env[KEY] = "test-secret-for-hmac-signing";
});
afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

describe("workspace cookie signing", () => {
  it("round-trips a slug through sign -> verify", async () => {
    const signed = await signWorkspaceCookie("acme-corp");
    expect(signed).toMatch(/^acme-corp\.[0-9a-f]{64}$/);
    expect(await verifyWorkspaceCookie(signed)).toBe("acme-corp");
  });

  it("rejects a tampered signature", async () => {
    const signed = await signWorkspaceCookie("acme-corp");
    const tampered = signed.slice(0, -1) + (signed.endsWith("0") ? "1" : "0");
    expect(await verifyWorkspaceCookie(tampered)).toBeNull();
  });

  it("rejects a valid signature reused for a different slug (the IDOR attempt)", async () => {
    // Attacker takes the hmac they hold for their own slug and swaps the slug.
    const mine = await signWorkspaceCookie("attacker-corp");
    const mac = mine.slice(mine.lastIndexOf(".") + 1);
    const forged = `victim-corp.${mac}`;
    expect(await verifyWorkspaceCookie(forged)).toBeNull();
  });

  it("rejects a bare, unsigned slug", async () => {
    expect(await verifyWorkspaceCookie("victim-corp")).toBeNull();
  });

  it("rejects empty / missing values", async () => {
    expect(await verifyWorkspaceCookie("")).toBeNull();
    expect(await verifyWorkspaceCookie(null)).toBeNull();
    expect(await verifyWorkspaceCookie(undefined)).toBeNull();
    expect(await verifyWorkspaceCookie("slug.")).toBeNull();
    expect(await verifyWorkspaceCookie(".mac")).toBeNull();
  });

  it("fails closed when the server secret is absent", async () => {
    delete process.env[KEY];
    // Signing degrades to a bare slug...
    expect(await signWorkspaceCookie("acme-corp")).toBe("acme-corp");
    // ...which verification then rejects (never silently accepted).
    expect(await verifyWorkspaceCookie("acme-corp")).toBeNull();
  });
});
