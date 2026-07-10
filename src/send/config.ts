import { readEncryptionKey, readOAuthDeps } from "@/src/crm/config";
import type { SandboxConfig } from "./guard";

/**
 * Send-path config readers (R10, U11). Two SOURCES, deliberately kept apart:
 *
 *  1. The D9 sandbox allowlist is INFRASTRUCTURE — the fail-closed firewall that
 *     decides who a send may reach. It stays in env (`SEND_SANDBOX_*`): it is the
 *     firewall, not per-tenant data, and a misconfigured deploy must block, not send.
 *  2. The sequence + sender (which sequence, which inbox, which user) are PER-TENANT
 *     — each connected HubSpot portal runs its own. They live on the connection row
 *     (`db/schema/crm.ts`), read via `readConnectionSendConfig`, NOT from env.
 *
 * Kept out of the pure send modules so those stay env-free/testable.
 */

/** The per-tenant send identity, resolved from a connection row (never env). */
export interface ConnectionSendConfig {
  sequenceId: string;
  senderEmail: string;
  userId: string;
}

function splitList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Read the D9 sandbox allowlist from env. REQUIRED / fail-closed (D9): with no
 * sandbox addresses configured, `guard.assertSandboxTarget` blocks every send, so
 * a misconfigured deploy cannot fire at anyone. Never throws — an empty allowlist
 * is a valid (blocking) state, unlike the old bundled reader.
 */
export function readSandboxConfig(
  env: Record<string, string | undefined> = process.env,
): SandboxConfig {
  return {
    allowedEmails: splitList(env.SEND_SANDBOX_EMAILS),
    allowedDomains: splitList(env.SEND_SANDBOX_DOMAINS),
    allowSubaddressTag: env.SEND_SANDBOX_ALLOW_SUBADDRESS === "true",
  };
}

/**
 * Extract the per-connection send config from a resolved connection row. Returns
 * null when the portal hasn't finished sequence setup — sequence_id is the piece
 * that must be pasted (no HubSpot list-sequence API), and senderEmail/userId
 * auto-capture at connect but a legacy row can predate that. A null result is the
 * honest "not configured yet" signal: the send gate shows the RevOps handoff, and
 * `/api/send` returns its 503 instead of a broken enroll.
 */
export function readConnectionSendConfig(conn: {
  sequenceId: string | null;
  senderEmail: string | null;
  senderUserId: string | null;
}): ConnectionSendConfig | null {
  if (!conn.sequenceId || !conn.senderEmail || !conn.senderUserId) return null;
  return {
    sequenceId: conn.sequenceId,
    senderEmail: conn.senderEmail,
    userId: conn.senderUserId,
  };
}

/**
 * Is the send INFRASTRUCTURE configured — the env pieces `/api/send` needs before
 * it can enroll at all: the token encryption key AND the OAuth client env. This is
 * the env half of send-readiness; the per-tenant half (a connection that finished
 * sequence setup) is `readConnectionSendConfig` against the resolved connection.
 * The brief's live Send button lights up only when BOTH halves are satisfied
 * (see `app/practice/[id]/page.tsx`); otherwise it falls back to the RevOps gate.
 */
export function isSendInfraConfigured(): boolean {
  try {
    readEncryptionKey();
    readOAuthDeps();
    return true;
  } catch {
    return false;
  }
}
