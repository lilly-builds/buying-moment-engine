import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSendConfigured } from "@/src/send/config";

/**
 * `isSendConfigured` gates the brief's live Send button: it must be true ONLY when a
 * `POST /api/send` would get past the route's 503 "Send is not configured" gate — i.e.
 * the token encryption key, the OAuth client env, AND the sequence/sender env are all
 * present. The case that matters most (and the one that bit us live): a HubSpot OAuth
 * connection can exist while the send env is still absent — the button must NOT go live
 * then, so the brief shows the RevOps handoff gate instead of a Send that errors.
 */
const ENC_KEY_B64 = Buffer.alloc(32, 3).toString("base64");

function stubFullyConfigured() {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", ENC_KEY_B64);
  vi.stubEnv("HUBSPOT_CLIENT_ID", "client-abc");
  vi.stubEnv("HUBSPOT_CLIENT_SECRET", "secret-xyz");
  vi.stubEnv("HUBSPOT_REDIRECT_URI", "https://app.example.com/api/hubspot/oauth");
  vi.stubEnv("HUBSPOT_SEQUENCE_ID", "123456");
  vi.stubEnv("HUBSPOT_SENDER_EMAIL", "rep@example.com");
  vi.stubEnv("HUBSPOT_SENDER_USER_ID", "42");
}

describe("isSendConfigured", () => {
  beforeEach(() => {
    // Start every case from a fully-configured baseline, isolated from ambient env,
    // so a single override is what flips the result.
    stubFullyConfigured();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is true when the encryption key, OAuth env, and send env are all present", () => {
    expect(isSendConfigured()).toBe(true);
  });

  it("is false when the send env is absent (connection exists, sequence/sender not set)", () => {
    // The exact live scenario: a stored HubSpot connection, but no sequence/sender env.
    vi.stubEnv("HUBSPOT_SEQUENCE_ID", "");
    expect(isSendConfigured()).toBe(false);
  });

  it("is false when the sender email or user id is missing", () => {
    vi.stubEnv("HUBSPOT_SENDER_EMAIL", "");
    expect(isSendConfigured()).toBe(false);
    stubFullyConfigured();
    vi.stubEnv("HUBSPOT_SENDER_USER_ID", "");
    expect(isSendConfigured()).toBe(false);
  });

  it("is false when the token encryption key is missing", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
    expect(isSendConfigured()).toBe(false);
  });

  it("is false when the OAuth client env is incomplete", () => {
    vi.stubEnv("HUBSPOT_CLIENT_SECRET", "");
    expect(isSendConfigured()).toBe(false);
  });
});
