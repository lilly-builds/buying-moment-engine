/**
 * CRM adapter — the CRM-agnostic contract (R8, R11, U10). THIS interface is the
 * product; HubSpot (`hubspot.ts`) is one binding, Salesforce a future one. It is
 * deliberately thin and provider-neutral: every field here is a human/business
 * concept, never a HubSpot-specific shape. R11: this is a custom connector — no
 * Zapier — so the surface stays small and owned.
 *
 * Three verbs:
 *   - pushLead   : land a tool-sourced lead as company + contact + deal (idempotent).
 *   - tagLead    : update the mutable tags on an already-pushed lead (e.g. ae_quality).
 *   - recordStage: read the deal's pipeline stage + timing back for the ROI scoreboard.
 */

/** The four first-class tags every pushed lead carries (R8). */
export interface LeadTags {
  /** Practice vertical (dermatology, womens_health, ...). */
  vertical: string;
  /** Which detector surfaced the buying moment (e.g. "greenhouse"). */
  signalSource: string;
  /** Distinct fired-signal kinds — the derived "how hot" number (R17). */
  signalCount: number;
  /** AE thumbs verdict, set/updated when the AE votes ("up" | "down" | null). */
  aeQuality?: string | null;
}

/** The business decision-maker (D9: never a patient — business people only). */
export interface LeadContact {
  name?: string | null;
  role: string;
  email?: string | null;
  linkedinUrl?: string | null;
}

/** A tool-sourced lead in neutral terms — the input to `pushLead`. */
export interface LeadInput {
  companyName: string;
  domain?: string | null;
  city?: string | null;
  state?: string | null;
  contact?: LeadContact | null;
  tags: LeadTags;
}

/** The provider-side ids we persist in `crm_links` to make pushes idempotent. */
export interface CrmLinkRef {
  companyId?: string | null;
  contactId?: string | null;
  dealId?: string | null;
}

export interface PushResult {
  companyId: string;
  contactId: string;
  dealId: string;
  /** true = newly created; false = an existing record was UPDATED (idempotent). */
  created: boolean;
}

/** What `recordStage` reads back for the ROI scoreboard (U12 consumes this). */
export interface StageReadback {
  stage: string;
  /** When the deal was created in the CRM. */
  enteredAt: Date | null;
  /** When the deal reached its current (won/closed) stage, if it has. */
  closedAt: Date | null;
  /** Days from enteredAt -> closedAt, or null while still open. */
  cycleTimeDays: number | null;
}

/**
 * Called after EACH object (company, then contact, then deal) is resolved, with
 * the cumulative ids so far. Lets the caller persist ids incrementally so a
 * hard failure mid-sequence leaves a partial link that a retry UPDATES rather
 * than re-creating (keeps the "never duplicates" guarantee on the error path).
 */
export type PushProgress = (ref: CrmLinkRef) => Promise<void> | void;

export interface CrmAdapter {
  /**
   * Land a lead as company + contact + deal carrying all four tags. If `existing`
   * carries provider ids the records are UPDATED in place (never duplicated).
   * `onProgress` fires after each object with the ids resolved so far.
   */
  pushLead(
    input: LeadInput,
    existing?: CrmLinkRef | null,
    onProgress?: PushProgress,
  ): Promise<PushResult>;

  /** Update the mutable tags on an already-pushed lead (the AE 👍/👎 change). */
  tagLead(ref: CrmLinkRef, tags: Partial<LeadTags>): Promise<void>;

  /** Read the deal's current pipeline stage + timing back for the scoreboard. */
  recordStage(ref: CrmLinkRef): Promise<StageReadback>;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Cycle time in days between two instants (pure, provider-neutral). Returns null
 * if either bound is missing so an open deal reads as "no cycle time yet" rather
 * than a fabricated 0 (KTD: never claim a number we can't source).
 */
export function computeCycleTimeDays(
  from: Date | null | undefined,
  to: Date | null | undefined,
): number | null {
  if (!from || !to) return null;
  return (to.getTime() - from.getTime()) / MS_PER_DAY;
}
