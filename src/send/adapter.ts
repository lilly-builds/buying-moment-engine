/**
 * Send adapter — the provider-neutral send contract (R10, U11). Mirrors the
 * CRM adapter idiom (`src/crm/adapter.ts`): THIS interface is the product; the
 * HubSpot Sequences binding (`hubspot-send.ts`) is the demo path, and Outreach
 * (`src/outreach/adapter.ts`) is the optional future binding. Keeping both behind
 * one interface is what lets the app-owned cadence (`cadence.ts`) drive either
 * without knowing which platform actually carries the email.
 *
 * There are NO paid calls on this path: HubSpot Sequences enrollment and the
 * contact-property write both ride the free OAuth grant (no per-call charge), and
 * Outreach authenticates via OAuth too — so nothing here routes through
 * `src/roi/cost-meter.ts` (R19). That is correct, not an omission: R19 meters
 * money spent (Claude, PDL, detector data APIs), and the send path spends none.
 */

/**
 * D9 firewall classification. Only a `sandbox` recipient may ever be sent to in
 * this project — every contact resolved from a REAL practice is `real_practice`
 * and can never receive a send (proven by a network-spy test). There is no
 * default: the caller must state which one, so a real contact can never slip
 * through as an unmarked value.
 */
export type RecipientClassification = "sandbox" | "real_practice";

export interface Recipient {
  /** Provider-side contact/prospect id (already pushed to the CRM by U10). */
  contactId: string;
  /** The recipient address — checked against the sandbox allowlist (D9 guard). */
  email: string;
  /** D9: only "sandbox" is sendable. A real-practice contact is never sent to. */
  classification: RecipientClassification;
}

export type SendProvider = "hubspot" | "outreach";

/** One touch handed to the adapter — the AE's approved, edited plain-text email. */
export interface SendTouchInput {
  recipient: Recipient;
  /** Which touch in the 3-touch cadence (1..3) — for traceability. */
  touchNumber: number;
  /** The exact edited subject line the AE approved (shipped verbatim). */
  subject: string;
  /** The exact edited plain-text body the AE approved (shipped verbatim). */
  body: string;
  /** The named next-step CTA carried on the sequence (R4). */
  cta?: string | null;
}

export interface SendResult {
  provider: SendProvider;
  contactId: string;
  touchNumber: number;
  /** True once the contact is enrolled / the send is dispatched. */
  enrolled: boolean;
}

/**
 * The one verb the cadence calls. A binding sends ONE touch: it makes the
 * recipient's approved body deliverable through the rep's own inbox and dispatches
 * it. The cadence (`cadence.ts`) owns WHEN each touch fires and reply-detection;
 * the adapter owns HOW one touch ships.
 */
export interface SendAdapter {
  readonly provider: SendProvider;
  sendTouch(input: SendTouchInput): Promise<SendResult>;
}
