import type { SandboxConfig } from "./guard";

/**
 * Production env readers for the send path (R10, U11). Kept out of the pure
 * modules so those stay env-free/testable. Each throws a NON-secret error when a
 * value is missing, so a route can answer 503 "send not configured" without
 * leaking anything. Empty until the live wire-up (U15) — until then these throw
 * and the send-gate stays in its honest gated state.
 */

export interface HubSpotSendConfig {
  sequenceId: string;
  senderEmail: string;
  userId: string;
  sandbox: SandboxConfig;
}

function splitList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Read the send config from env. The sandbox allowlist is REQUIRED (fail-closed,
 * D9): with no sandbox addresses configured, `guard.assertSandboxRecipient`
 * blocks every send, so a misconfigured deploy cannot fire at anyone.
 */
export function readHubSpotSendConfig(
  env: Record<string, string | undefined> = process.env,
): HubSpotSendConfig {
  const sequenceId = env.HUBSPOT_SEQUENCE_ID;
  const senderEmail = env.HUBSPOT_SENDER_EMAIL;
  const userId = env.HUBSPOT_SENDER_USER_ID;
  if (!sequenceId || !senderEmail || !userId) {
    throw new Error("HubSpot send env is not fully configured");
  }
  return {
    sequenceId,
    senderEmail,
    userId,
    sandbox: {
      allowedEmails: splitList(env.SEND_SANDBOX_EMAILS),
      allowedDomains: splitList(env.SEND_SANDBOX_DOMAINS),
      allowSubaddressTag: env.SEND_SANDBOX_ALLOW_SUBADDRESS === "true",
    },
  };
}
