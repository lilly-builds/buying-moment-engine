import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Token-at-rest encryption (R8, U10, D9). AES-256-GCM authenticated encryption
 * for the per-tenant OAuth tokens stored in `crm_connections`.
 *
 * PURE by design: `encrypt`/`decrypt` take the 32-byte key as a PARAMETER — they
 * never read env. The production caller reads `TOKEN_ENCRYPTION_KEY`, runs it
 * through `normalizeKey`, and passes the Buffer in; tests pass a fixed key. This
 * keeps the crypto unit-testable with no env and no I/O.
 *
 * Wire format (base64 of): [ 12-byte IV | 16-byte GCM auth tag | ciphertext ].
 * GCM authenticates the ciphertext, so a tampered/truncated blob throws on
 * decrypt rather than returning garbage.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `encryption key must be exactly ${KEY_BYTES} bytes (got ${key.length})`,
    );
  }
}

export function encrypt(plaintext: string, key: Buffer): string {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decrypt(payload: string, key: Buffer): string {
  assertKey(key);
  const buf = Buffer.from(payload, "base64");
  if (buf.length < IV_BYTES + AUTH_TAG_BYTES) {
    throw new Error("ciphertext is too short to be valid");
  }
  const iv = buf.subarray(0, IV_BYTES);
  const authTag = buf.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + AUTH_TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8",
  );
}

/**
 * Normalize a configured key string to a 32-byte Buffer. Accepts a 64-char hex
 * string or a base64 string that decodes to 32 bytes. Throws otherwise, so a
 * misconfigured key fails loudly at startup rather than silently weakening crypto.
 * Generate one with: `openssl rand -base64 32`.
 */
export function normalizeKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  const decoded = Buffer.from(trimmed, "base64");
  if (decoded.length === KEY_BYTES) return decoded;
  throw new Error(
    "TOKEN_ENCRYPTION_KEY must be 32 bytes as base64 or 64 hex chars",
  );
}
