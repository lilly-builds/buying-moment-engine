import { asc, eq } from "drizzle-orm";
import type { Database } from "@/db/types";
import { contacts, practices } from "@/db/schema";
import { getActiveConnection } from "@/db/crm";
import { practiceSignalRows } from "@/db/queries";
import type { LeadInput } from "@/src/crm/adapter";
import { createHubSpotAdapter } from "@/src/crm/hubspot";
import { hasSendScope, type OAuthHttpDeps } from "@/src/crm/hubspot-oauth";
import { createDbTokenProvider, pushPracticeLead } from "@/src/crm/sync";
import type { Recipient, RecipientClassification } from "./adapter";
import type { HubSpotSendConfig } from "./config";
import { assertSandboxTarget, RealPracticeSendBlockedError } from "./guard";
import { createHubSpotSender } from "./hubspot-send";

/**
 * Send-a-brief orchestrator (U11) — the flow the dashboard's "Send" button drives.
 * It turns an AE's edited email into a live HubSpot Sequences enrollment, guarded
 * to the sandbox address (D9). The route handler stays thin (auth + parse + call
 * this); this flow is unit-tested against PGlite + a mocked HubSpot fetch, mirroring
 * `syncPracticeLead`.
 *
 * The order is load-bearing:
 *   1. Resolve the recipient SERVER-SIDE from the practice's own contact row — the
 *      request body NEVER carries the address (a client cannot redirect a send).
 *   2. Run the D9 firewall FIRST, before ANY HubSpot call. A blocked send throws
 *      here, so no request ever leaves the process for a non-sandbox recipient.
 *   3. Resolve the HubSpot connection SERVER-SIDE (no portal id from input — IDOR),
 *      and confirm the GRANTED scopes include Sequences enrollment.
 *   4. Ensure the contact exists in HubSpot (the idempotent CRM push mints/returns
 *      its `contactId`), then enroll — which writes the edited subject + body into
 *      the two custom contact properties and sends through the rep's connected inbox.
 */

/**
 * The seed marks every non-real, demo/sandbox practice with a `demo:` geo-key
 * prefix (`db/seed-demo.ts`); the real discovery pipeline never uses it. That makes
 * it an INDEPENDENT D9 signal from the address allowlist: a real practice can never
 * carry it, so even an address wrongly added to `SEND_SANDBOX_EMAILS` still cannot
 * send unless its practice is a sandbox seed — the two conditions the firewall wants
 * to be independent stay independent (see `guard.ts`).
 */
const SANDBOX_GEO_PREFIX = "demo:";

export interface SendBriefEmailArgs {
  practiceId: string;
  /** The AE's exact edited subject line (shipped verbatim). */
  subject: string;
  /** The AE's exact edited plain-text body (shipped verbatim). */
  body: string;
  /** The named next-step CTA carried on the sequence (R4), if any. */
  cta?: string | null;
  encryptionKey: Buffer;
  sendConfig: HubSpotSendConfig;
  provider?: string;
}

export interface SendBriefEmailSuccess {
  ok: true;
  contactId: string;
  touchNumber: number;
  enrolled: boolean;
}

export type SendBriefEmailResult =
  | SendBriefEmailSuccess
  | { ok: false; status: number; error: string };

interface ResolvedRecipient {
  email: string;
  classification: RecipientClassification;
  lead: LeadInput;
}

/**
 * Resolve the send target from the DB alone: the practice + its decision-maker
 * contact. Returns null when the practice has no contact address to send to.
 */
async function resolveRecipient(
  db: Database,
  practiceId: string,
): Promise<ResolvedRecipient | null> {
  const [practice] = await db
    .select({
      name: practices.name,
      city: practices.city,
      state: practices.state,
      vertical: practices.vertical,
      geoKey: practices.geoKey,
    })
    .from(practices)
    .where(eq(practices.id, practiceId))
    .limit(1);
  if (!practice) return null;

  // The SAME decision-maker the brief displays and was written for: pick by role
  // order exactly as `src/brief/inputs.ts` does (a practice can hold >1 contact), then
  // require an address. If the brief's contact has none, there is nothing to send —
  // which matches the card, where the Send button is disabled without an email.
  const [contact] = await db
    .select({
      name: contacts.name,
      role: contacts.role,
      email: contacts.email,
      linkedinUrl: contacts.linkedinUrl,
    })
    .from(contacts)
    .where(eq(contacts.practiceId, practiceId))
    .orderBy(asc(contacts.role))
    .limit(1);
  if (!contact?.email) return null;

  // D9 classification is the practice's own nature, NOT the address (see the prefix
  // note above): a demo/sandbox seed is `sandbox`, a real discovered practice is not.
  const classification: RecipientClassification = practice.geoKey.startsWith(
    SANDBOX_GEO_PREFIX,
  )
    ? "sandbox"
    : "real_practice";

  const rows = await practiceSignalRows(db, practiceId);
  const signalCount = new Set(rows.map((r) => r.kind)).size;
  const signalSource = rows.find((r) => r.signalSource)?.signalSource ?? "unknown";

  const lead: LeadInput = {
    companyName: practice.name,
    city: practice.city,
    state: practice.state,
    contact: {
      name: contact.name,
      role: contact.role,
      email: contact.email,
      linkedinUrl: contact.linkedinUrl,
    },
    tags: { vertical: practice.vertical, signalSource, signalCount },
  };

  return { email: contact.email, classification, lead };
}

/**
 * Wire Send → push contact → enroll, guarded to the sandbox address. Returns a
 * status the route maps to an HTTP response; throws only on a genuinely unexpected
 * failure (a HubSpot 5xx), which the route surfaces as 502.
 */
export async function sendBriefEmail(
  db: Database,
  deps: OAuthHttpDeps,
  args: SendBriefEmailArgs,
): Promise<SendBriefEmailResult> {
  const provider = args.provider ?? "hubspot";

  const resolved = await resolveRecipient(db, args.practiceId);
  if (!resolved) {
    return {
      ok: false,
      status: 422,
      error: "This practice has no contact email to send to",
    };
  }

  // ── D9 FIRST — before any HubSpot call. A non-sandbox recipient throws here. ──
  try {
    assertSandboxTarget(
      { email: resolved.email, classification: resolved.classification },
      args.sendConfig.sandbox,
    );
  } catch (err) {
    if (err instanceof RealPracticeSendBlockedError) {
      return { ok: false, status: 403, error: err.message };
    }
    throw err;
  }

  // ── Connection resolved SERVER-SIDE (no portal id from input — IDOR). ──
  const active = await getActiveConnection(db, provider);
  if (!active.ok) {
    return active.reason === "none"
      ? { ok: false, status: 409, error: "No HubSpot connection — connect HubSpot first" }
      : { ok: false, status: 503, error: "Multiple HubSpot connections — cannot resolve one" };
  }
  if (!hasSendScope(active.connection.scopes)) {
    return {
      ok: false,
      status: 403,
      error: "Connected HubSpot account cannot send (missing Sequences enrollment scope)",
    };
  }

  const getAccessToken = createDbTokenProvider(db, deps, {
    portalId: active.connection.portalId, // server-resolved, never client-supplied
    encryptionKey: args.encryptionKey,
    provider,
  });

  // Ensure the contact exists in HubSpot (idempotent) and get its provider id.
  const pushed = await pushPracticeLead(
    db,
    createHubSpotAdapter({ fetch: deps.fetch, getAccessToken }),
    { practiceId: args.practiceId, lead: resolved.lead, provider },
  );

  // Enroll: writes the edited subject + body into the two custom contact
  // properties and sends the token step through the rep's connected inbox. The
  // sender re-runs the D9 firewall with the real contactId (belt and suspenders).
  const sender = createHubSpotSender({
    fetch: deps.fetch,
    getAccessToken,
    baseUrl: deps.baseUrl,
    sequenceId: args.sendConfig.sequenceId,
    senderEmail: args.sendConfig.senderEmail,
    userId: args.sendConfig.userId,
    sandbox: args.sendConfig.sandbox,
    // The custom properties are provisioned OUT OF BAND (portal setup): the send
    // grant holds `crm.objects.contacts.write` but not `crm.schemas.contacts.write`.
    provisionProperty: false,
  });

  const recipient: Recipient = {
    contactId: pushed.contactId,
    email: resolved.email,
    classification: resolved.classification,
  };
  const result = await sender.sendTouch({
    recipient,
    touchNumber: 1,
    subject: args.subject,
    body: args.body,
    cta: args.cta ?? null,
  });

  return {
    ok: true,
    contactId: result.contactId,
    touchNumber: result.touchNumber,
    enrolled: result.enrolled,
  };
}
