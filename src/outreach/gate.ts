/**
 * Outreach credential gate (R10, U11) — PURE. Outreach is the OPTIONAL future
 * send adapter, kept only for orgs that mandate a sales-engagement platform;
 * HubSpot covers send for the demo. The gate is the whole story of "built, but
 * off": with the OAuth credential set absent the adapter is INERT, and the
 * send-gate UI reads the honest "ready — awaiting Outreach credentials".
 *
 * OAuth 2.0 only — no static API keys ever. The three env values are the full
 * credential set; a dormant Outreach refresh token expires in ~14 days (noted in
 * the README) so this stays dark until an org actually activates it.
 */

export interface OutreachCredentials {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
}

/** The exact copy the U9/U11 send-gate renders while Outreach is dark. */
export const OUTREACH_AWAITING_MESSAGE = "ready — awaiting Outreach credentials";

export type OutreachGateState = "awaiting_credentials" | "credentialed";

export interface OutreachGateStatus {
  /** True only when ALL of client id + secret + refresh token are present. */
  credentialed: boolean;
  state: OutreachGateState;
  /** UI copy for the send-gate element (owned by U9; state supplied here). */
  message: string;
}

/** Read the three OAuth values from env (empty by design in the demo). */
export function readOutreachCredentials(
  env: Record<string, string | undefined> = process.env,
): OutreachCredentials {
  return {
    clientId: env.OUTREACH_CLIENT_ID || undefined,
    clientSecret: env.OUTREACH_CLIENT_SECRET || undefined,
    refreshToken: env.OUTREACH_REFRESH_TOKEN || undefined,
  };
}

/** True only when the FULL OAuth credential set is present (pure). */
export function isOutreachActivatable(creds: OutreachCredentials): boolean {
  return Boolean(creds.clientId && creds.clientSecret && creds.refreshToken);
}

/** The gate state the send-gate UI renders (pure). */
export function outreachGateStatus(creds: OutreachCredentials): OutreachGateStatus {
  const credentialed = isOutreachActivatable(creds);
  return credentialed
    ? { credentialed: true, state: "credentialed", message: "Outreach connected" }
    : {
        credentialed: false,
        state: "awaiting_credentials",
        message: OUTREACH_AWAITING_MESSAGE,
      };
}
