import { describe, expect, it } from "vitest";
import type { Recipient } from "@/src/send/adapter";
import {
  assertSandboxRecipient,
  isSandboxEmail,
  RealPracticeSendBlockedError,
  type SandboxConfig,
} from "@/src/send/guard";

function recipient(over: Partial<Recipient>): Recipient {
  return {
    contactId: "ct_1",
    email: "qa@sandbox.test",
    classification: "sandbox",
    ...over,
  };
}

describe("isSandboxEmail (pure)", () => {
  it("matches an exact allowlisted address, case-insensitively", () => {
    const cfg: SandboxConfig = { allowedEmails: ["QA@Sandbox.Test"] };
    expect(isSandboxEmail("qa@sandbox.test", cfg)).toBe(true);
    expect(isSandboxEmail("other@sandbox.test", cfg)).toBe(false);
  });

  it("matches a whole allowlisted domain", () => {
    const cfg: SandboxConfig = { allowedDomains: ["sandbox.test"] };
    expect(isSandboxEmail("anyone@sandbox.test", cfg)).toBe(true);
    expect(isSandboxEmail("anyone@real-derm.com", cfg)).toBe(false);
  });

  it("matches a +sandbox sub-address tag only when enabled, and only exactly", () => {
    const on: SandboxConfig = { allowSubaddressTag: true };
    expect(isSandboxEmail("qa+sandbox@gmail.com", on)).toBe(true);
    // a substring like +sandboxed must NOT match (mirrors hasSendScope's rule)
    expect(isSandboxEmail("qa+sandboxed@gmail.com", on)).toBe(false);
    const off: SandboxConfig = {};
    expect(isSandboxEmail("qa+sandbox@gmail.com", off)).toBe(false);
  });

  it("is fail-closed: an empty config matches nothing", () => {
    expect(isSandboxEmail("qa@sandbox.test", {})).toBe(false);
    expect(isSandboxEmail("", {})).toBe(false);
    expect(isSandboxEmail("not-an-email", { allowedDomains: ["sandbox.test"] })).toBe(false);
  });
});

describe("assertSandboxRecipient (D9 firewall)", () => {
  const cfg: SandboxConfig = { allowedDomains: ["sandbox.test"] };

  it("passes a sandbox-classified recipient with a sandbox address", () => {
    expect(() => assertSandboxRecipient(recipient({}), cfg)).not.toThrow();
  });

  it("BLOCKS a real-practice contact even if its address were sandbox", () => {
    expect(() =>
      assertSandboxRecipient(recipient({ classification: "real_practice" }), cfg),
    ).toThrow(RealPracticeSendBlockedError);
  });

  it("BLOCKS a mislabeled sandbox recipient whose address is NOT registered", () => {
    // The load-bearing second condition: flipping the flag on a real address
    // must still not send.
    expect(() =>
      assertSandboxRecipient(
        recipient({ classification: "sandbox", email: "owner@real-derm.com" }),
        cfg,
      ),
    ).toThrow(RealPracticeSendBlockedError);
  });

  it("never leaks the recipient address in the error message (D9)", () => {
    try {
      assertSandboxRecipient(
        recipient({ classification: "sandbox", email: "owner@real-derm.com" }),
        cfg,
      );
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).not.toContain("real-derm.com");
    }
  });
});
