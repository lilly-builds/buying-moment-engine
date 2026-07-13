import {
  createHubSpotRequest,
  isTolerated,
  type HubSpotHttpDeps,
} from "@/src/crm/hubspot-http";
import { LEAD_PROPERTY_GROUP } from "@/src/crm/hubspot-properties";
import type {
  Recipient,
  SendResult,
  SendTouchInput,
  SendSequenceInput,
  SequenceSendAdapter,
  SequenceTouchInput,
} from "./adapter";
import { assertSandboxRecipient, type SandboxConfig } from "./guard";

/**
 * HubSpot binding of the send adapter (R10, U11) — the whole-body-`{{custom_body}}`
 * -token trick (spec § Stack). HubSpot Sequence templates are token-only (no
 * free-text-body param), so to ship the AE's EXACT edited subject + plain-text body we:
 *
 *   1. write the edited subject + body into custom contact properties — ONE PAIR
 *      PER TOUCH: touch 1 → `gtm_maestro_custom_subject` / `_body` (the original,
 *      unsuffixed pair), touch 2 → `..._subject_2` / `..._body_2`, touch 3 → `_3`,
 *      then
 *   2. enroll the contact ONCE into a multi-step Sequence whose email steps token
 *      to the matching pair — step 1 to the touch-1 tokens, step 2 to the `_2`
 *      tokens, step 3 to the `_3` tokens.
 *
 * Enrolling ONCE (not once per touch) is load-bearing: a contact can be in only
 * one active Sequence enrollment and there is no unenroll API, so a second enroll
 * 400s `CONTACT_ALREADY_ENROLLED`. The Sequence itself drips the touches; the
 * per-touch property pairs are what make each dripped email carry its OWN copy
 * instead of a static "bump" (`sendSequence`, 2026-07-10).
 *
 * Subject is tokenised too (a deliberate extension of the spec's body-only lock,
 * 2026-07-09) because the subject line drives open rate — an AE shipping someone
 * else's static subject is a real weakness for cold email.
 *
 * It then sends through the rep's OWN connected inbox, so HubSpot's native
 * open/click/reply tracking + CRM logging come free while the exact email ships.
 * The Sequence itself is a one-time per-portal artifact (its id is config).
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

/** Touch 1's body property — the original, unsuffixed pair (kept for back-compat). */
export const CUSTOM_BODY_PROPERTY = "gtm_maestro_custom_body";

/** Touch 1's subject property — the original, unsuffixed pair (kept for back-compat). */
export const CUSTOM_SUBJECT_PROPERTY = "gtm_maestro_custom_subject";

/** How many touches the Sequence carries — one property pair + one email step each. */
export const SEND_TOUCH_COUNT = 3;

/**
 * The (subject, body) contact-property names touch N's edited copy is written into.
 * Touch 1 keeps the ORIGINAL unsuffixed names (the send path shipped before per-touch
 * copy existed); touches 2..N add a numeric suffix — matching the Sequence's tokenised
 * email steps. Pure — the single source of truth for the naming both provisioning and
 * the PATCH agree on.
 */
export function touchPropertyPair(touchNumber: number): {
  subject: string;
  body: string;
} {
  const suffix = touchNumber <= 1 ? "" : `_${touchNumber}`;
  return {
    subject: `${CUSTOM_SUBJECT_PROPERTY}${suffix}`,
    body: `${CUSTOM_BODY_PROPERTY}${suffix}`,
  };
}

/** Every send-property name (subject + body for every touch) — for provisioning + tests. */
export const SEND_PROPERTY_NAMES: readonly string[] = Array.from(
  { length: SEND_TOUCH_COUNT },
  (_unused, i) => touchPropertyPair(i + 1),
).flatMap((pair) => [pair.subject, pair.body]);

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

/** The multi-line body property for touch N — the token trick writes into it (pure). */
export function bodyPropertyPayload(touchNumber: number): Record<string, unknown> {
  return {
    name: touchPropertyPair(touchNumber).body,
    // The visible label MUST equal the token name the Chrome-setup prompt tells the
    // agent to insert (SEQUENCE_SETUP.chromePrompt) — the agent picks the token by
    // this label. connections.test.ts locks the two together so they never drift.
    label:
      touchNumber <= 1
        ? "GTM Maestro Custom Body"
        : `GTM Maestro Custom Body ${touchNumber}`,
    type: "string",
    // textarea = multi-line, so plain-text bodies with newlines round-trip intact.
    fieldType: "textarea",
    groupName: LEAD_PROPERTY_GROUP,
  };
}

/** The single-line subject property for touch N — the edited subject writes into it (pure). */
export function subjectPropertyPayload(touchNumber: number): Record<string, unknown> {
  return {
    name: touchPropertyPair(touchNumber).subject,
    // Label MUST equal the prompt's token name (see bodyPropertyPayload note).
    label:
      touchNumber <= 1
        ? "GTM Maestro Custom Subject"
        : `GTM Maestro Custom Subject ${touchNumber}`,
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
 * Create the per-touch subject + body contact properties (+ their group), and
 * RECONCILE the label on any that already exist — the whole set: one (subject,
 * body) pair for each of the `SEND_TOUCH_COUNT` touches. A write to a property
 * that does not exist 400s, so the token trick needs every pair the Sequence
 * steps reference provisioned first.
 *
 * Why reconcile the label (not just tolerate 409): the sequence's email steps pick
 * each personalization token BY LABEL, and the app matches the prompt's token names
 * (`connections.test.ts`). A portal provisioned by an older build carries a stale
 * label (e.g. "GTM Maestro — email subject"), so a token labelled "GTM Maestro
 * Custom Subject" would resolve to nothing and the email would render blank. The
 * app — not the setup agent — must reliably get the field name right, so on every
 * connect/reconnect we PATCH the label of an existing property back to canonical.
 * Idempotent: a correct label PATCHes to itself. (Unlike the tag properties, whose
 * labels an admin may legitimately customise, these are GTM Maestro-owned plumbing
 * that must equal the prompt verbatim, so reconciling them is correct.)
 *
 * Rides connect-time provisioning (`completeHubSpotConnect`); also callable on the
 * send path for out-of-band setup. Called once per sender (memoised below).
 *
 * `reconcileLabels` (default true) does the label-fix PATCH above. Connect passes
 * it (that's when the sequence is being built and the label must be right); the
 * send path passes `false` — by then the sequence's tokens are already bound to the
 * internal names, so relabeling would be 6 pointless PATCHes on the hot path.
 */
export async function ensureSendProperties(
  deps: HubSpotHttpDeps,
  opts?: { reconcileLabels?: boolean },
): Promise<{ created: string[]; relabeled: string[] }> {
  const reconcileLabels = opts?.reconcileLabels ?? true;
  const request = createHubSpotRequest(deps);
  await request(
    "POST",
    "/crm/v3/properties/contacts/groups",
    { name: LEAD_PROPERTY_GROUP, label: "GTM Maestro" },
    { tolerate: ALREADY_EXISTS },
  );
  const created: string[] = [];
  const relabeled: string[] = [];
  for (let touchNumber = 1; touchNumber <= SEND_TOUCH_COUNT; touchNumber++) {
    for (const payload of [
      subjectPropertyPayload(touchNumber),
      bodyPropertyPayload(touchNumber),
    ]) {
      const name = String(payload.name);
      const res = await request("POST", "/crm/v3/properties/contacts", payload, {
        tolerate: ALREADY_EXISTS,
      });
      if (!isTolerated(res)) {
        // Freshly created — it already carries the canonical label.
        created.push(name);
        continue;
      }
      if (!reconcileLabels) continue;
      // Already existed: force its label to the canonical value so the token the
      // Sequence step inserts (picked by label) always resolves to this property.
      await request("PATCH", `/crm/v3/properties/contacts/${name}`, {
        label: payload.label,
      });
      relabeled.push(name);
    }
  }
  return { created, relabeled };
}

export function createHubSpotSender(deps: HubSpotSendDeps): SequenceSendAdapter {
  const rawRequest = createHubSpotRequest(deps);
  // This binding never tolerates a status on the object/enroll calls.
  const request = rawRequest as <T>(
    method: string,
    path: string,
    body?: unknown,
  ) => Promise<T>;

  // Provision the custom properties AT MOST once per sender, lazily on first send.
  // Skipped entirely when they are provisioned out of band (see deps).
  const shouldProvision = deps.provisionProperty ?? true;
  let ensured: Promise<unknown> | null = null;
  function ensureOnce(): Promise<unknown> {
    if (!ensured) {
      // No label reconcile on the send path: by send time the sequence's tokens are
      // already bound to the internal names, so a relabel here would be dead weight.
      // Connect (completeHubSpotConnect) does the reconcile, at setup time.
      ensured = shouldProvision
        ? ensureSendProperties(deps, { reconcileLabels: false })
        : Promise.resolve();
    }
    return ensured;
  }

  /**
   * Write every touch's copy into its own property pair (ONE PATCH) and enroll the
   * contact ONCE. The single write path behind both `sendTouch` (one touch) and
   * `sendSequence` (the whole cadence), so the D9-first order, the length guard, and
   * the enroll-once invariant can never drift between them.
   */
  async function writeAndEnroll(
    recipient: Recipient,
    touches: readonly SequenceTouchInput[],
  ): Promise<SendResult> {
    // D9 FIRST — before any provisioning, property write, or enrollment. A
    // real-practice recipient throws here, so no request ever leaves the process.
    assertSandboxRecipient(recipient, deps.sandbox);

    if (touches.length === 0) {
      throw new Error("a send needs at least one touch");
    }
    // Validate EVERY body before any I/O, so an over-long touch fails loudly here
    // rather than as an opaque 400 mid-PATCH (experiment #2 — fidelity + limits).
    for (const touch of touches) {
      if (touch.body.length > MAX_CUSTOM_BODY_CHARS) {
        throw new BodyTooLongError(touch.body.length);
      }
    }

    await ensureOnce();

    // 1. Write each touch's EXACT edited subject + body into ITS property pair, in
    //    ONE PATCH. The Sequence's step-N tokens render the touch-N pair.
    const properties: Record<string, string> = {};
    for (const touch of touches) {
      const pair = touchPropertyPair(touch.touchNumber);
      properties[pair.subject] = touch.subject;
      properties[pair.body] = touch.body;
    }
    await request("PATCH", `/crm/v3/objects/contacts/${recipient.contactId}`, {
      properties,
    });

    // 2. Enroll the contact ONCE — HubSpot drips its multi-step Sequence through the
    //    rep's connected inbox, each email rendering its own touch's tokens. userId
    //    is a query param, not a body field.
    await request(
      "POST",
      `/automation/sequences/${HUBSPOT_SEQUENCES_VERSION}/enrollments?userId=${encodeURIComponent(deps.userId)}`,
      enrollmentPayload({
        sequenceId: deps.sequenceId,
        contactId: recipient.contactId,
        senderEmail: deps.senderEmail,
      }),
    );

    const first = [...touches].sort((a, b) => a.touchNumber - b.touchNumber)[0];
    return {
      provider: "hubspot",
      contactId: recipient.contactId,
      touchNumber: first.touchNumber,
      enrolled: true,
    };
  }

  /** Back-compat: a single touch is a one-touch launch (used by the app-owned cadence). */
  async function sendTouch(input: SendTouchInput): Promise<SendResult> {
    return writeAndEnroll(input.recipient, [
      {
        touchNumber: input.touchNumber,
        subject: input.subject,
        body: input.body,
        cta: input.cta,
      },
    ]);
  }

  /** Launch the whole cadence — every touch's copy shipped in one enroll. */
  async function sendSequence(input: SendSequenceInput): Promise<SendResult> {
    return writeAndEnroll(input.recipient, input.touches);
  }

  return { provider: "hubspot", sendTouch, sendSequence };
}
