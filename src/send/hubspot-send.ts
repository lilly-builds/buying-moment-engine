import {
  createHubSpotRequest,
  isTolerated,
  type HubSpotHttpDeps,
} from "@/src/crm/hubspot-http";
import { LEAD_PROPERTY_GROUP } from "@/src/crm/hubspot-properties";
import type {
  Recipient,
  SendAdapter,
  SendResult,
  SendTouchInput,
} from "./adapter";
import { assertSandboxRecipient, type SandboxConfig } from "./guard";

/**
 * HubSpot binding of the send adapter (R10, U11) — the whole-body-`{{custom_body}}`
 * -token trick (spec § Stack). HubSpot Sequence templates are token-only (no
 * free-text-body param), so to ship the AE's EXACT edited subject + plain-text body we:
 *
 *   1. write the edited subject + body into TWO custom contact properties
 *      (`gtm_maestro_custom_subject`, `gtm_maestro_custom_body`), then
 *   2. enroll the contact into a Sequence whose single step has
 *      Subject = `{{ contact.gtm_maestro_custom_subject }}` and
 *      Body    = `{{ contact.gtm_maestro_custom_body }}`.
 *
 * Subject is tokenised too (a deliberate extension of the spec's body-only lock,
 * 2026-07-09) because the subject line drives open rate — an AE shipping someone
 * else's static subject is a real weakness for cold email.
 *
 * It then sends through the rep's OWN connected inbox, so HubSpot's native
 * open/click/reply tracking + CRM logging come free while the exact email ships.
 * The Sequence itself is a one-time per-portal artifact (its id is config); the
 * app owns the 3-touch cadence (`cadence.ts`), not HubSpot's scheduler.
 *
 * All auth/retry/timeout is REUSED from `hubspot-http.ts` (the same policy the CRM
 * push uses); the access token comes from the same proactively-refreshing provider
 * (`createDbTokenProvider`) on the same OAuth grant. This module only wires the
 * two calls and enforces the D9 firewall first.
 *
 * Endpoint verified against HubSpot docs 2026-07 (mocked in CI; live smoke in U15):
 *   POST /automation/sequences/2026-03/enrollments?userId=<id>
 *   body { sequenceId, contactId, senderEmail } · scope automation.sequences.enrollments.write
 */

/** The custom contact property the AE's edited body is written into. */
export const CUSTOM_BODY_PROPERTY = "gtm_maestro_custom_body";

/** The custom contact property the AE's edited subject line is written into. */
export const CUSTOM_SUBJECT_PROPERTY = "gtm_maestro_custom_subject";

/** Dated Sequences API version (the `{v}` in the plan; matches platform 2026.03). */
export const HUBSPOT_SEQUENCES_VERSION = "2026-03";

/**
 * HubSpot's ceiling for a multi-line ("textarea") text property value. The body
 * is validated against this BEFORE any call so an over-long body fails loudly
 * here rather than as an opaque 400 mid-enrollment (experiment #2 — fidelity + limits).
 */
export const MAX_CUSTOM_BODY_CHARS = 65_536;

export class BodyTooLongError extends Error {
  constructor(length: number) {
    super(
      `Email body is ${length} chars — over the ${MAX_CUSTOM_BODY_CHARS}-char HubSpot property limit`,
    );
    this.name = "BodyTooLongError";
  }
}

/** The multi-line contact property the token trick writes into (pure payload). */
export function customBodyPropertyPayload(): Record<string, unknown> {
  return {
    name: CUSTOM_BODY_PROPERTY,
    label: "GTM Maestro — email body",
    type: "string",
    // textarea = multi-line, so plain-text bodies with newlines round-trip intact.
    fieldType: "textarea",
    groupName: LEAD_PROPERTY_GROUP,
  };
}

/** The single-line contact property the edited subject line writes into (pure). */
export function customSubjectPropertyPayload(): Record<string, unknown> {
  return {
    name: CUSTOM_SUBJECT_PROPERTY,
    label: "GTM Maestro — email subject",
    type: "string",
    // A subject is one line — single-line text.
    fieldType: "text",
    groupName: LEAD_PROPERTY_GROUP,
  };
}

/** The enrollment request body HubSpot expects (pure). */
export function enrollmentPayload(args: {
  sequenceId: string;
  contactId: string;
  senderEmail: string;
}): Record<string, string> {
  return {
    sequenceId: args.sequenceId,
    contactId: args.contactId,
    senderEmail: args.senderEmail,
  };
}

export interface HubSpotSendDeps extends HubSpotHttpDeps {
  /** The pre-built Sequence (single `{{custom_body}}` step) to enroll into. */
  sequenceId: string;
  /** The rep's connected-inbox address the send goes through. */
  senderEmail: string;
  /** The acting user's id — HubSpot wants it as the `userId` query param. */
  userId: string;
  /** D9 firewall config — which addresses are sandbox (fail-closed if empty). */
  sandbox: SandboxConfig;
  /**
   * Auto-create the custom body property on first send (default true). Set false
   * when the property is provisioned OUT OF BAND — e.g. against a live grant that
   * lacks `crm.schemas.contacts.write` (verified on portal 246709373: the U10
   * grant holds `crm.objects.contacts.write` for the PATCH + the Sequences send
   * scope, but not the contacts-SCHEMA write provisioning needs). The property is
   * then created once in HubSpot and the send path only writes + enrolls, which
   * the grant already permits.
   */
  provisionProperty?: boolean;
}

const ALREADY_EXISTS = [409] as const;

/**
 * Create the subject + body contact properties (+ their group) if absent.
 * Idempotent (tolerate 409, like `ensureLeadProperties`): a write to a property
 * that does not exist 400s, so the token trick needs both provisioned first.
 * Ideally this rides connect-time provisioning; kept on the send path so U11 does
 * not reach into U10's connect flow. Called once per sender (memoised below).
 */
export async function ensureSendProperties(
  deps: HubSpotHttpDeps,
): Promise<{ created: string[] }> {
  const request = createHubSpotRequest(deps);
  await request(
    "POST",
    "/crm/v3/properties/contacts/groups",
    { name: LEAD_PROPERTY_GROUP, label: "GTM Maestro" },
    { tolerate: ALREADY_EXISTS },
  );
  const created: string[] = [];
  for (const payload of [customSubjectPropertyPayload(), customBodyPropertyPayload()]) {
    const res = await request("POST", "/crm/v3/properties/contacts", payload, {
      tolerate: ALREADY_EXISTS,
    });
    if (!isTolerated(res)) created.push(String(payload.name));
  }
  return { created };
}

export function createHubSpotSender(deps: HubSpotSendDeps): SendAdapter {
  const rawRequest = createHubSpotRequest(deps);
  // This binding never tolerates a status on the object/enroll calls.
  const request = rawRequest as <T>(
    method: string,
    path: string,
    body?: unknown,
  ) => Promise<T>;

  // Provision the custom property AT MOST once per sender, lazily on first send.
  // Skipped entirely when the property is provisioned out of band (see deps).
  const shouldProvision = deps.provisionProperty ?? true;
  let ensured: Promise<unknown> | null = null;
  function ensureOnce(): Promise<unknown> {
    if (!ensured) {
      ensured = shouldProvision ? ensureSendProperties(deps) : Promise.resolve();
    }
    return ensured;
  }

  async function sendTouch(input: SendTouchInput): Promise<SendResult> {
    const recipient: Recipient = input.recipient;

    // D9 FIRST — before any provisioning, property write, or enrollment. A
    // real-practice recipient throws here, so no request ever leaves the process.
    assertSandboxRecipient(recipient, deps.sandbox);

    if (input.body.length > MAX_CUSTOM_BODY_CHARS) {
      throw new BodyTooLongError(input.body.length);
    }

    await ensureOnce();

    // 1. Write the EXACT edited subject + body into the two custom contact
    //    properties (one PATCH). The Sequence step's Subject + Body tokens render them.
    await request("PATCH", `/crm/v3/objects/contacts/${recipient.contactId}`, {
      properties: {
        [CUSTOM_SUBJECT_PROPERTY]: input.subject,
        [CUSTOM_BODY_PROPERTY]: input.body,
      },
    });

    // 2. Enroll the contact — HubSpot sends the `{{custom_body}}`-token step
    //    through the rep's connected inbox. userId is a query param, not a body field.
    await request(
      "POST",
      `/automation/sequences/${HUBSPOT_SEQUENCES_VERSION}/enrollments?userId=${encodeURIComponent(deps.userId)}`,
      enrollmentPayload({
        sequenceId: deps.sequenceId,
        contactId: recipient.contactId,
        senderEmail: deps.senderEmail,
      }),
    );

    return {
      provider: "hubspot",
      contactId: recipient.contactId,
      touchNumber: input.touchNumber,
      enrolled: true,
    };
  }

  return { provider: "hubspot", sendTouch };
}
