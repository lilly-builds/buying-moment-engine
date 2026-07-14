import { asc, eq } from "drizzle-orm";
import type { Database } from "@/db/types";
import { contacts, practices } from "@/db/schema";
import { getActiveConnection } from "@/db/crm";
import { claimSend, confirmSend, releaseSend } from "@/db/outreach";
import { practiceSignalRows } from "@/db/queries";
import type { LeadInput } from "@/src/crm/adapter";
import { createHubSpotAdapter } from "@/src/crm/hubspot";
import { hasSendScope, type OAuthHttpDeps } from "@/src/crm/hubspot-oauth";
import { createDbTokenProvider, pushPracticeLead } from "@/src/crm/sync";
import { HubSpotRequestError } from "@/src/crm/hubspot-http";
import type { Recipient, RecipientClassification } from "./adapter";
import { readConnectionSendConfig } from "./config";
import type { SandboxConfig } from "./guard";
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
 *      its `contactId`), then enroll ONCE — which writes each touch's edited subject
 *      + body into its own custom-contact-property pair and sends through the rep's
 *      connected inbox, the Sequence dripping each touch's own copy.
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

/** One AE-approved touch handed to the send — its position + exact edited copy. */
export interface SendBriefTouch {
  /** Which touch in the cadence (1..3) — decides its Sequence email step / property pair. */
  touchNumber: number;
  /** The AE's exact edited subject line (shipped verbatim). */
  subject: string;
  /** The AE's exact edited plain-text body (shipped verbatim). */
  body: string;
}

export interface SendBriefEmailArgs {
  practiceId: string;
  /**
   * The AE's exact edited touches (>=1). All are shipped in ONE enroll — each
   * written into the property pair for its `touchNumber`, so the Sequence's step-N
   * email renders touch N's own copy. A single-touch array still works (touch 1 only).
   */
  touches: SendBriefTouch[];
  /** The named next-step CTA carried on the sequence (R4), if any. */
  cta?: string | null;
  encryptionKey: Buffer;
  /** The D9 sandbox allowlist (env — the firewall). The sequence + sender identity
   *  are NOT passed in; they're read from the resolved connection, server-side. */
  sandbox: SandboxConfig;
  /**
   * WHO is sending — the allowlisted session email from the route's auth guard. Stamped
   * on the shared `outreach_sends` claim so the dashboard can show "Sent by X" and so a
   * concurrent second sender is told who beat them. Server-supplied, never from the body.
   */
  sentBy: string;
  provider?: string;
}

export interface SendBriefEmailSuccess {
  ok: true;
  contactId: string;
  /** The first (lowest) touch number shipped — the enrollment starts here. */
  touchNumber: number;
  /** How many touches' copy was shipped in the enroll. */
  touchesSent: number;
  enrolled: boolean;
  /** WHO sent it — echoes back the session email for the "Sent by X" label. */
  sentBy: string;
  /** When the send was confirmed (ISO) — the "on <date>" in the shared Sent label. */
  sentAt: string;
}

export type SendBriefEmailResult =
  | SendBriefEmailSuccess
  // `alreadySent` marks the ONE 409 that means "another AE already claimed/sent this
  // lead" — distinct from the other 409 ("No HubSpot connection"). The UI locks the
  // Send button only on the former; the latter stays a normal retryable error.
  | { ok: false; status: number; error: string; alreadySent?: boolean };

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
 * Map a caught send error to a USER-actionable result, or null to let it propagate to
 * the route's generic 502 (a dev-only failure the AE can only retry). We surface only the
 * failures a user can actually fix on their HubSpot side, each with our OWN wording — the
 * raw HubSpot message is never used (D9); we key off the normalized, PII-free `reason`.
 * `already_enrolled` is intentionally NOT mapped here: with the claim guard it should not
 * occur, and handling it correctly is a separate change (the ambiguous-retry path).
 */
function userActionableSendError(
  err: unknown,
): { status: number; error: string } | null {
  if (!(err instanceof HubSpotRequestError)) return null;
  switch (err.reason) {
    case "sales_subscription_inactive":
      return {
        status: 422,
        error:
          "HubSpot can't send right now: your Sales Hub subscription or seat looks inactive. Reactivate it in HubSpot, then try again.",
      };
    case "no_connected_inbox":
      return {
        status: 422,
        error:
          "HubSpot can't send yet: connect your sending inbox in HubSpot (Settings, then Email), then try again.",
      };
    default:
      return null;
  }
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

  // Defensive: the route validates this, but a launch with no touches has nothing
  // to ship — fail before resolving anything (400, not an opaque downstream throw).
  if (args.touches.length === 0) {
    return { ok: false, status: 400, error: "No touches to send" };
  }

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
      args.sandbox,
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

  // The sequence + sender identity come from THIS connection (per-tenant), not env.
  // No sequence_id yet → sequence setup isn't finished: return the clean 503 the
  // brief's gate already expects, and NEVER attempt a broken enroll.
  const sendConfig = readConnectionSendConfig(active.connection);
  if (!sendConfig) {
    return {
      ok: false,
      status: 503,
      error: "Send is not configured — finish HubSpot sequence setup",
    };
  }

  // ── CLAIM the send BEFORE any HubSpot mutation (shared-workspace concurrency
  //    guard). All the checks above are read-only, so it is safe to run them twice on
  //    two concurrent clicks; the enroll is NOT — a second one overwrites the draft
  //    then 400s CONTACT_ALREADY_ENROLLED. The atomic claim lets exactly ONE click
  //    reach HubSpot; the loser returns here with who holds it, before touching a
  //    thing. Placed after the config gates so an unconfigured send leaves no claim. ──
  const claim = await claimSend(db, args.practiceId, args.sentBy);
  if (!claim.ok) {
    const who = claim.existing.sentBy;
    return {
      ok: false,
      status: 409,
      error:
        claim.existing.status === "sent"
          ? `Already sent by ${who}.`
          : `${who} is sending this right now.`,
      alreadySent: true,
    };
  }

  const getAccessToken = createDbTokenProvider(db, deps, {
    portalId: active.connection.portalId, // server-resolved, never client-supplied
    encryptionKey: args.encryptionKey,
    provider,
  });

  let result;
  try {
    // Ensure the contact exists in HubSpot (idempotent) and get its provider id.
    const pushed = await pushPracticeLead(
      db,
      createHubSpotAdapter({ fetch: deps.fetch, getAccessToken }),
      { practiceId: args.practiceId, lead: resolved.lead, provider },
    );

    // Enroll: writes each touch's edited subject + body into its property pair and
    // sends the token steps through the rep's connected inbox. The sender re-runs the
    // D9 firewall with the real contactId (belt and suspenders).
    const sender = createHubSpotSender({
      fetch: deps.fetch,
      getAccessToken,
      baseUrl: deps.baseUrl,
      sequenceId: sendConfig.sequenceId,
      senderEmail: sendConfig.senderEmail,
      userId: sendConfig.userId,
      sandbox: args.sandbox,
      // The custom properties are provisioned at CONNECT (`completeHubSpotConnect` →
      // `ensureSendProperties`, now that `crm.schemas.contacts.write` is a required
      // scope), so the send path only writes + enrolls. The sender's default would
      // provision on first send; false keeps the hot path to two calls (PATCH + enroll).
      provisionProperty: false,
    });

    const recipient: Recipient = {
      contactId: pushed.contactId,
      email: resolved.email,
      classification: resolved.classification,
    };
    // Launch the whole cadence in ONE enroll: each touch's copy lands in the property
    // pair for its touchNumber, so the Sequence's step-N email renders touch N's own
    // copy. The named CTA rides the touches (rendered as the sequence's link in the
    // HubSpot template — see onboarding/hubspot-setup-handoff.md).
    result = await sender.sendSequence({
      recipient,
      touches: args.touches.map((t) => ({
        touchNumber: t.touchNumber,
        subject: t.subject,
        body: t.body,
        cta: args.cta ?? null,
      })),
    });
  } catch (err) {
    // The send FAILED after we claimed it — release the claim so this lead can be
    // retried and is never left falsely marked "sent". Re-throw so the route maps it to
    // its 502. releaseSend is best-effort cleanup, GUARDED in its own try/catch so a
    // failed release can never SHADOW the real HubSpot error (its own throw would
    // replace `err` and the AE would see the wrong cause). A claim left `sending` by a
    // failed release still self-heals via claimSend's stale-claim TTL on a later attempt.
    try {
      await releaseSend(db, args.practiceId);
    } catch (releaseErr) {
      console.error(
        `[send] releaseSend failed for practice ${args.practiceId} — claim left 'sending' (auto-recovers via claimSend's stale-claim TTL):`,
        releaseErr,
      );
    }
    // If HubSpot rejected the send for a reason the AE can FIX (an inactive Sales seat,
    // no connected inbox), return that clear, retryable message instead of a generic 502.
    // Nothing shipped and the claim is now released, so retrying after the fix is safe.
    const actionable = userActionableSendError(err);
    if (actionable) {
      return { ok: false, status: actionable.status, error: actionable.error };
    }
    throw err;
  }

  // Send succeeded — flip the claim to `sent` so the shared button locks with "Sent by
  // X" for everyone. The enrollment already shipped, so a failure of THIS audit write
  // must NOT surface as a failed send — that would make the AE retry an email that went
  // out. Deliberate suppression: log it loudly server-side and still return success. The
  // row stays `sending` (still locked, so NO duplicate); it does NOT self-correct on its
  // own, so it is recovered by claimSend's stale-claim TTL steal on a later attempt — a
  // rare, fail-safe edge (a post-enroll DB blip on one UPDATE, or the request being
  // killed before this line).
  const sentAt = new Date();
  try {
    const confirmed = await confirmSend(db, args.practiceId, sentAt);
    if (!confirmed) {
      // No row updated — the claim vanished between enroll and confirm (a stale-claim
      // steal, or a manual release). The email shipped, so still succeed, but log it:
      // this is the only signal that a sent lead is not marked `sent`.
      console.error(
        `[send] enrollment shipped but confirmSend updated 0 rows for practice ${args.practiceId} — 'sent' state not recorded`,
      );
    }
  } catch (err) {
    console.error(
      `[send] enrollment shipped but outreach_sends flip to 'sent' failed for practice ${args.practiceId} — row left 'sending' (auto-recovers via claimSend's stale-claim TTL):`,
      err,
    );
  }

  return {
    ok: true,
    contactId: result.contactId,
    touchNumber: result.touchNumber,
    touchesSent: args.touches.length,
    enrolled: result.enrolled,
    sentBy: args.sentBy,
    sentAt: sentAt.toISOString(),
  };
}
