import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../setup";
import {
  loadProviderCredentialEnc,
  storeProviderCredential,
} from "@/db/integrations";
import { readEncryptionKey } from "@/src/crm/config";
import { encrypt } from "@/src/crm/token-crypto";
import {
  isKeyProvider,
  providerEnvVar,
  providerLabel,
  resolveProviderKey,
  validateProviderKey,
} from "@/src/keys/provider-keys";

/**
 * The BYOK provider-key module (U17). Proves the three contracts the thread turns
 * on: format validation catches the wrong key before it's billed; a stored key is
 * encrypted at rest (never plaintext) and preferred over the env fallback; and a
 * broken stored key degrades to env rather than taking the engine offline.
 */

// A fixed 32-byte key so encrypt/decrypt is deterministic in the test.
const TEST_ENC_KEY = Buffer.alloc(32, 5).toString("base64");

describe("validateProviderKey", () => {
  it("accepts a well-formed Anthropic key (sk-ant- prefix)", () => {
    expect(validateProviderKey("anthropic", "sk-ant-api03-" + "a".repeat(40)).ok).toBe(true);
  });

  it("rejects a non-Anthropic value in the Anthropic slot", () => {
    expect(validateProviderKey("anthropic", "pk_live_123456789012345").ok).toBe(false);
    expect(validateProviderKey("anthropic", "sk-ant-short").ok).toBe(false);
  });

  it("accepts a plausible PDL token and rejects junk", () => {
    expect(validateProviderKey("pdl", "a1b2c3d4e5f60718293a4b5c6d7e8f90").ok).toBe(true);
    expect(validateProviderKey("pdl", "too short").ok).toBe(false); // has a space
    expect(validateProviderKey("pdl", "short").ok).toBe(false);
  });

  it("rejects empty / whitespace-only, with a helpful reason", () => {
    const r = validateProviderKey("anthropic", "   ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/paste a key/i);
  });

  it("trims a trailing newline from a copy-paste before validating", () => {
    expect(validateProviderKey("anthropic", "sk-ant-api03-" + "a".repeat(40) + "\n").ok).toBe(true);
  });
});

describe("provider registry helpers", () => {
  it("isKeyProvider narrows to the known set only", () => {
    expect(isKeyProvider("anthropic")).toBe(true);
    expect(isKeyProvider("pdl")).toBe(true);
    expect(isKeyProvider("openai")).toBe(false);
    expect(isKeyProvider(42)).toBe(false);
    expect(isKeyProvider(null)).toBe(false);
  });

  it("maps each provider to its env var + label", () => {
    expect(providerEnvVar("anthropic")).toBe("ANTHROPIC_API_KEY");
    expect(providerEnvVar("pdl")).toBe("PDL_API_KEY");
    expect(providerLabel("anthropic")).toMatch(/anthropic/i);
    expect(providerLabel("pdl")).toMatch(/people data labs/i);
  });
});

describe("stored key encryption (D9)", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    process.env.TOKEN_ENCRYPTION_KEY = TEST_ENC_KEY;
  });
  afterEach(async () => {
    await t.close();
    delete process.env.TOKEN_ENCRYPTION_KEY;
  });

  it("stores ciphertext, never the plaintext key", async () => {
    const plaintext = "sk-ant-api03-" + "z".repeat(40);
    await storeProviderCredential(t.db, {
      provider: "anthropic",
      secretEnc: encrypt(plaintext, readEncryptionKey()),
    });
    const stored = await loadProviderCredentialEnc(t.db, "anthropic");
    expect(stored).toBeTruthy();
    expect(stored).not.toBe(plaintext);
    expect(stored).not.toContain(plaintext);
    expect(stored).not.toContain("sk-ant-");
  });

  it("re-pasting a key UPDATES in place (one row, idempotent)", async () => {
    await storeProviderCredential(t.db, { provider: "pdl", secretEnc: encrypt("first-key-value-000000", readEncryptionKey()) });
    await storeProviderCredential(t.db, { provider: "pdl", secretEnc: encrypt("second-key-value-11111", readEncryptionKey()) });
    const resolved = await resolveProviderKey(t.db, "pdl");
    expect(resolved).toBe("second-key-value-11111");
  });
});

describe("resolveProviderKey — stored first, env fallback", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    process.env.TOKEN_ENCRYPTION_KEY = TEST_ENC_KEY;
  });
  afterEach(async () => {
    await t.close();
    delete process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("prefers the stored key over the env key", async () => {
    process.env.ANTHROPIC_API_KEY = "env-key-should-lose";
    await storeProviderCredential(t.db, {
      provider: "anthropic",
      secretEnc: encrypt("stored-key-wins", readEncryptionKey()),
    });
    expect(await resolveProviderKey(t.db, "anthropic")).toBe("stored-key-wins");
  });

  it("falls back to the env key when nothing is stored", async () => {
    process.env.ANTHROPIC_API_KEY = "env-fallback-key";
    expect(await resolveProviderKey(t.db, "anthropic")).toBe("env-fallback-key");
  });

  it("returns null when neither a stored nor an env key exists", async () => {
    expect(await resolveProviderKey(t.db, "pdl")).toBeNull();
  });

  it("degrades to env when the stored ciphertext can't be decrypted (soft-fail)", async () => {
    process.env.ANTHROPIC_API_KEY = "env-safety-net";
    // A value that isn't valid ciphertext for this key — decrypt must throw and we
    // must NOT let that take the engine offline.
    await storeProviderCredential(t.db, { provider: "anthropic", secretEnc: "not-real-ciphertext" });
    expect(await resolveProviderKey(t.db, "anthropic")).toBe("env-safety-net");
  });
});

describe("provider_credentials is RLS-locked (deny-by-default)", () => {
  it("the migration enables Row-Level Security on the table", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const dir = path.resolve(here, "../../db/migrations");
    const sql = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(path.join(dir, f), "utf8"))
      .join("\n");
    expect(sql).toMatch(
      /ALTER TABLE "provider_credentials" ENABLE ROW LEVEL SECURITY/i,
    );
  });
});
