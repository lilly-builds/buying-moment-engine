import { eq } from "drizzle-orm";
import type { Database } from "./types";
import { integrationRequests, providerCredentials } from "./schema";

/**
 * Integration-requests data-layer helper (U17). Storage side of the "request an
 * integration" capture on the Connections page — one insert, returning the id so
 * the route can confirm the write actually landed (never assert success without
 * proof). Mirrors the thin-helper shape of `db/crm.ts`.
 */

export interface RecordIntegrationRequestArgs {
  tool: string;
  category?: string | null;
  note?: string | null;
  /** The allowlisted email that made the request (provenance, R17). */
  requestedBy?: string | null;
}

export async function recordIntegrationRequest(
  db: Database,
  args: RecordIntegrationRequestArgs,
): Promise<{ id: string }> {
  const [row] = await db
    .insert(integrationRequests)
    .values({
      tool: args.tool,
      category: args.category ?? null,
      note: args.note ?? null,
      requestedBy: args.requestedBy ?? null,
    })
    .returning({ id: integrationRequests.id });
  return { id: row.id };
}

/**
 * Provider-credential (BYOK engine key) storage helpers (U17). The plaintext key
 * NEVER reaches this layer: the caller encrypts it (AES-256-GCM) and hands us only
 * the ciphertext. Reads return the ciphertext for server-side decryption, or a
 * bare boolean presence — never the secret to the client (D9).
 */

export interface StoreProviderCredentialArgs {
  provider: string;
  /** AES-256-GCM ciphertext of the API key — never the plaintext. */
  secretEnc: string;
}

/** Upsert the encrypted key for a provider — re-pasting UPDATES, never dupes. */
export async function storeProviderCredential(
  db: Database,
  args: StoreProviderCredentialArgs,
): Promise<void> {
  await db
    .insert(providerCredentials)
    .values({ provider: args.provider, secretEnc: args.secretEnc })
    .onConflictDoUpdate({
      target: providerCredentials.provider,
      set: { secretEnc: args.secretEnc, updatedAt: new Date() },
    });
}

/** The stored ciphertext for a provider, or null if no key is set. */
export async function loadProviderCredentialEnc(
  db: Database,
  provider: string,
): Promise<string | null> {
  const [row] = await db
    .select({ secretEnc: providerCredentials.secretEnc })
    .from(providerCredentials)
    .where(eq(providerCredentials.provider, provider))
    .limit(1);
  return row?.secretEnc ?? null;
}

/**
 * Whether a stored key exists for a provider — selects ONLY the provider column,
 * so the ciphertext never leaves the DB when all we need is a status pill.
 */
export async function hasProviderCredential(
  db: Database,
  provider: string,
): Promise<boolean> {
  const [row] = await db
    .select({ provider: providerCredentials.provider })
    .from(providerCredentials)
    .where(eq(providerCredentials.provider, provider))
    .limit(1);
  return row != null;
}
