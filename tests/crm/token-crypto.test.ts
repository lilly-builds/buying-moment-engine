import { describe, expect, it } from "vitest";
import { decrypt, encrypt, normalizeKey } from "@/src/crm/token-crypto";

/** Fixed test key (32 bytes) — the crypto takes the key as a param, no env. */
const TEST_KEY = Buffer.alloc(32, 7);

describe("token-crypto (AES-256-GCM)", () => {
  it("round-trips encrypt -> decrypt back to the plaintext", () => {
    const plaintext = "hubspot-access-token-abc123";
    const ciphertext = encrypt(plaintext, TEST_KEY);
    expect(decrypt(ciphertext, TEST_KEY)).toBe(plaintext);
  });

  it("stores ciphertext that is NOT the plaintext", () => {
    const plaintext = "refresh-token-xyz";
    const ciphertext = encrypt(plaintext, TEST_KEY);
    expect(ciphertext).not.toBe(plaintext);
    expect(ciphertext).not.toContain(plaintext);
  });

  it("uses a fresh IV so the same plaintext encrypts differently each time", () => {
    const a = encrypt("same", TEST_KEY);
    const b = encrypt("same", TEST_KEY);
    expect(a).not.toBe(b);
    expect(decrypt(a, TEST_KEY)).toBe("same");
    expect(decrypt(b, TEST_KEY)).toBe("same");
  });

  it("throws (GCM auth) when decrypted with the wrong key", () => {
    const ciphertext = encrypt("secret", TEST_KEY);
    const wrong = Buffer.alloc(32, 9);
    expect(() => decrypt(ciphertext, wrong)).toThrow();
  });

  it("throws when the ciphertext has been tampered with", () => {
    const ciphertext = encrypt("secret", TEST_KEY);
    const buf = Buffer.from(ciphertext, "base64");
    buf[buf.length - 1] ^= 0xff; // flip a ciphertext bit
    expect(() => decrypt(buf.toString("base64"), TEST_KEY)).toThrow();
  });

  it("rejects a key that is not 32 bytes", () => {
    expect(() => encrypt("x", Buffer.alloc(16))).toThrow();
  });

  describe("normalizeKey", () => {
    it("accepts a base64 32-byte key", () => {
      const raw = Buffer.alloc(32, 3).toString("base64");
      expect(normalizeKey(raw).length).toBe(32);
    });
    it("accepts a 64-char hex key", () => {
      const raw = Buffer.alloc(32, 4).toString("hex");
      const key = normalizeKey(raw);
      expect(key.length).toBe(32);
      expect(key.equals(Buffer.alloc(32, 4))).toBe(true);
    });
    it("throws on a key of the wrong size", () => {
      expect(() => normalizeKey("too-short")).toThrow();
    });
  });
});
