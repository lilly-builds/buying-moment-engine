import type { Database } from "@/db/types";
import { loadProviderCredentialEnc } from "@/db/integrations";
import { readEncryptionKey } from "@/src/crm/config";
import { decrypt } from "@/src/crm/token-crypto";

/**
 * BYOK engine keys (U17 · spec § Stack). The two credentials the tool runs the
 * paid work on — Anthropic (research + brief voice) and PDL (contact enrichment) —
 * are pasted once on the Connections surface, encrypted at rest, and read back
 * only here, server-side, to make the calls.
 *
 * This module is the ONE place the key list, its accepted format, and the
 * env-var fallback live, so the route, the page, and the job all agree on what a
 * valid Anthropic/PDL key is and where a stored key falls back to for the demo.
 *
 * SERVER-ONLY. It reads `TOKEN_ENCRYPTION_KEY` (via `readEncryptionKey`) and the
 * provider env vars, and it decrypts stored secrets — none of that may ever ship
 * to the browser. Never import it into a `"use client"` module.
 */

export type KeyProvider = "anthropic" | "pdl";

interface ProviderSpec {
  provider: KeyProvider;
  /** Human label for the Connections surface + error copy. */
  label: string;
  /** The env var the demo falls back to when no key is stored ("full value before a single key"). */
  envVar: string;
  /**
   * Format check. Deliberately conservative: it rejects obvious mistakes (empty,
   * a pasted sentence, a key with whitespace) WITHOUT being so strict it refuses a
   * real key. A wrong format here is a fast, honest "that doesn't look right" long
   * before a paid 401 from the provider.
   */
  validate: (raw: string) => boolean;
}

/** No whitespace, and a plausible key length. Real API keys are opaque tokens. */
function looksLikeToken(raw: string, min: number, max: number): boolean {
  return /^\S+$/.test(raw) && raw.length >= min && raw.length <= max;
}

const SPECS: Record<KeyProvider, ProviderSpec> = {
  anthropic: {
    provider: "anthropic",
    label: "Anthropic (Claude)",
    envVar: "ANTHROPIC_API_KEY",
    // Anthropic keys carry a documented, load-bearing prefix (`sk-ant-`); enforce
    // it so a paste of the wrong vendor's key is caught before it's ever billed.
    validate: (raw) => /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(raw),
  },
  pdl: {
    provider: "pdl",
    label: "People Data Labs",
    envVar: "PDL_API_KEY",
    // PDL keys have no universal prefix — enforce charset + length instead of a
    // shape we'd risk being wrong about and rejecting a valid key.
    validate: (raw) =>
      looksLikeToken(raw, 20, 256) && /^[A-Za-z0-9._-]+$/.test(raw),
  },
};

export const KEY_PROVIDERS: KeyProvider[] = ["anthropic", "pdl"];

export function isKeyProvider(value: unknown): value is KeyProvider {
  return typeof value === "string" && value in SPECS;
}

export function providerLabel(provider: KeyProvider): string {
  return SPECS[provider].label;
}

export type ValidateResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Validate a pasted key for a provider. Trims first (a trailing newline from a
 * copy-paste is not a real error), then applies the provider's format check.
 */
export function validateProviderKey(
  provider: KeyProvider,
  raw: string,
): ValidateResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "Paste a key first." };
  }
  if (!SPECS[provider].validate(trimmed)) {
    return {
      ok: false,
      reason: `That doesn't look like a ${SPECS[provider].label} key.`,
    };
  }
  return { ok: true };
}

/** The env var a provider's key falls back to for the keyless demo. */
export function providerEnvVar(provider: KeyProvider): string {
  return SPECS[provider].envVar;
}

/**
 * Resolve the API key to actually use for a provider: the STORED (encrypted) key
 * first, else the env var. This is the "full value before a single key" contract
 * (D14) — the demo runs on Lilly's env keys, and the moment EliseAI pastes their
 * own key it takes over, with nothing else to change.
 *
 * Fails SOFT to env on any storage/decrypt problem (no `TOKEN_ENCRYPTION_KEY`, DB
 * down, tampered ciphertext): a broken stored key must never take the engine
 * offline when a working env key is present. Returns null only when neither
 * source has a key.
 */
export async function resolveProviderKey(
  db: Database,
  provider: KeyProvider,
): Promise<string | null> {
  const stored = await loadStoredProviderKey(db, provider);
  if (stored) return stored;
  return process.env[SPECS[provider].envVar] ?? null;
}

/**
 * The decrypted stored key for a provider, or null if none is set or it can't be
 * decrypted. Isolated + swallow-to-null on purpose: `resolveProviderKey` treats a
 * null here as "fall back to env," so a decrypt/DB failure degrades rather than
 * throws. The plaintext is returned to the SERVER caller only.
 */
async function loadStoredProviderKey(
  db: Database,
  provider: KeyProvider,
): Promise<string | null> {
  try {
    const secretEnc = await loadProviderCredentialEnc(db, provider);
    if (!secretEnc) return null;
    return decrypt(secretEnc, readEncryptionKey());
  } catch {
    return null;
  }
}
