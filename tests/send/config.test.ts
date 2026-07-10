import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isSendInfraConfigured,
  readConnectionSendConfig,
  readSandboxConfig,
} from "@/src/send/config";

/**
 * Send-config readers, now split by SOURCE (per-connection-send-config):
 *  - `isSendInfraConfigured` gates on the ENV infra a send needs at all (token
 *    encryption key + OAuth client env). It is the env half of send-readiness.
 *  - `readConnectionSendConfig` is the PER-TENANT half: the sequence + sender read
 *    off the resolved connection row. Null = sequence setup unfinished → the brief
 *    shows the RevOps handoff, and /api/send returns 503, instead of a broken enroll.
 *  - `readSandboxConfig` reads the D9 firewall allowlist from env (fail-closed).
 */
const ENC_KEY_B64 = Buffer.alloc(32, 3).toString("base64");

function stubInfra() {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", ENC_KEY_B64);
  vi.stubEnv("HUBSPOT_CLIENT_ID", "client-abc");
  vi.stubEnv("HUBSPOT_CLIENT_SECRET", "secret-xyz");
  vi.stubEnv("HUBSPOT_REDIRECT_URI", "https://app.example.com/api/hubspot/oauth");
}

describe("isSendInfraConfigured", () => {
  beforeEach(() => {
    stubInfra();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is true when the encryption key and OAuth client env are present", () => {
    expect(isSendInfraConfigured()).toBe(true);
  });

  it("is false when the token encryption key is missing", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
    expect(isSendInfraConfigured()).toBe(false);
  });

  it("is false when the OAuth client env is incomplete", () => {
    vi.stubEnv("HUBSPOT_CLIENT_SECRET", "");
    expect(isSendInfraConfigured()).toBe(false);
  });

  it("does NOT depend on a sequence/sender env — those moved to the connection", () => {
    // The exact live scenario that bit us: infra present, no sequence env anywhere.
    // Infra is ready; the connection carries the per-tenant sequence separately.
    vi.stubEnv("HUBSPOT_SEQUENCE_ID", "");
    vi.stubEnv("HUBSPOT_SENDER_EMAIL", "");
    expect(isSendInfraConfigured()).toBe(true);
  });
});

describe("readConnectionSendConfig", () => {
  it("returns the send identity when the connection has all three fields", () => {
    expect(
      readConnectionSendConfig({
        sequenceId: "712515259",
        senderEmail: "rep@example.com",
        senderUserId: "42",
      }),
    ).toEqual({ sequenceId: "712515259", senderEmail: "rep@example.com", userId: "42" });
  });

  it("is null when the sequence id is missing (setup unfinished)", () => {
    expect(
      readConnectionSendConfig({
        sequenceId: null,
        senderEmail: "rep@example.com",
        senderUserId: "42",
      }),
    ).toBeNull();
  });

  it("is null when the sender email or user id is missing (legacy row)", () => {
    expect(
      readConnectionSendConfig({ sequenceId: "1", senderEmail: null, senderUserId: "42" }),
    ).toBeNull();
    expect(
      readConnectionSendConfig({ sequenceId: "1", senderEmail: "r@e.com", senderUserId: null }),
    ).toBeNull();
  });
});

describe("readSandboxConfig", () => {
  it("parses the comma-separated allowlists and the subaddress flag from env", () => {
    const cfg = readSandboxConfig({
      SEND_SANDBOX_EMAILS: "a@x.com, b@y.com",
      SEND_SANDBOX_DOMAINS: "sandbox.test",
      SEND_SANDBOX_ALLOW_SUBADDRESS: "true",
    });
    expect(cfg.allowedEmails).toEqual(["a@x.com", "b@y.com"]);
    expect(cfg.allowedDomains).toEqual(["sandbox.test"]);
    expect(cfg.allowSubaddressTag).toBe(true);
  });

  it("fails CLOSED: an empty env yields an empty allowlist (blocks every send)", () => {
    const cfg = readSandboxConfig({});
    expect(cfg.allowedEmails).toEqual([]);
    expect(cfg.allowedDomains).toEqual([]);
    expect(cfg.allowSubaddressTag).toBe(false);
  });
});
