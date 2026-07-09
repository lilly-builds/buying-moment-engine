import type {
  SendAdapter,
  SendResult,
  SendTouchInput,
} from "@/src/send/adapter";
import { assertSandboxRecipient, type SandboxConfig } from "@/src/send/guard";
import {
  isOutreachActivatable,
  type OutreachCredentials,
} from "./gate";

/**
 * Outreach binding of the send adapter (R10, U11) — the OPTIONAL future path,
 * behind a HARD credential gate. Two states:
 *
 *   - credentials ABSENT  → INERT. `sendTouch` throws `OutreachGatedError` with
 *     ZERO network I/O (proven by a network-spy test). This is the demo state.
 *   - credentials PRESENT → the token exchange + enrollment payload are exercised,
 *     but LIVE FIRE IS OUT OF SCOPE FOREVER in this project (R10/D9); readiness is
 *     proven only by a mocked contract-test suite. The D9 firewall still gates
 *     every recipient, so even a credentialed adapter cannot hit a real practice.
 *
 * OAuth 2.0 only — the refresh-token grant, no static keys. All HTTP is injected
 * so contract tests mock the token endpoint + the enrollment endpoint.
 */

export class OutreachGatedError extends Error {
  constructor() {
    super(
      "Outreach adapter is inert — awaiting Outreach credentials (OAuth client id + secret + refresh token)",
    );
    this.name = "OutreachGatedError";
  }
}

export const OUTREACH_API_BASE = "https://api.outreach.io";
export const OUTREACH_TOKEN_URL = "https://api.outreach.io/oauth/token";
export const OUTREACH_FETCH_TIMEOUT_MS = 15_000;

/** The refresh-token grant form Outreach's OAuth token endpoint expects (pure). */
export function outreachRefreshForm(creds: OutreachCredentials): Record<string, string> {
  return {
    grant_type: "refresh_token",
    client_id: creds.clientId ?? "",
    client_secret: creds.clientSecret ?? "",
    refresh_token: creds.refreshToken ?? "",
  };
}

/** The Outreach sequence-state (enrollment) payload for one touch (pure). */
export function outreachEnrollmentPayload(input: SendTouchInput, sequenceId: string) {
  return {
    data: {
      type: "sequenceState",
      relationships: {
        prospect: { data: { type: "prospect", id: input.recipient.contactId } },
        sequence: { data: { type: "sequence", id: sequenceId } },
      },
    },
  };
}

export interface OutreachSendDeps {
  credentials: OutreachCredentials;
  sequenceId: string;
  sandbox: SandboxConfig;
  fetch: typeof fetch;
  tokenUrl?: string;
  baseUrl?: string;
}

interface OutreachTokenResponse {
  access_token: string;
}

async function exchangeRefreshToken(deps: OutreachSendDeps): Promise<string> {
  const res = await deps.fetch(deps.tokenUrl ?? OUTREACH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(outreachRefreshForm(deps.credentials)).toString(),
    signal: AbortSignal.timeout(OUTREACH_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    // Never echo the body — it can carry the client secret.
    throw new Error(`Outreach token endpoint failed with ${res.status}`);
  }
  const json = (await res.json()) as OutreachTokenResponse;
  return json.access_token;
}

export function createOutreachAdapter(deps: OutreachSendDeps): SendAdapter {
  const activatable = isOutreachActivatable(deps.credentials);

  async function sendTouch(input: SendTouchInput): Promise<SendResult> {
    // Inert gate FIRST: with no credentials, throw before any I/O (network spy = 0).
    if (!activatable) throw new OutreachGatedError();

    // D9 firewall still binds a credentialed adapter — never a real practice.
    assertSandboxRecipient(input.recipient, deps.sandbox);

    const base = deps.baseUrl ?? OUTREACH_API_BASE;
    const accessToken = await exchangeRefreshToken(deps);
    const res = await deps.fetch(`${base}/api/v2/sequenceStates`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/vnd.api+json",
      },
      body: JSON.stringify(outreachEnrollmentPayload(input, deps.sequenceId)),
      signal: AbortSignal.timeout(OUTREACH_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Outreach enrollment failed with ${res.status}`);
    }

    return {
      provider: "outreach",
      contactId: input.recipient.contactId,
      touchNumber: input.touchNumber,
      enrolled: true,
    };
  }

  return { provider: "outreach", sendTouch };
}
