import { and, eq, isNull } from "drizzle-orm";
import { contacts, evidence, practiceFacts, practices } from "./schema";
import type { Database } from "./types";

/**
 * Enrichment persistence (U5). Idempotent by construction (R17):
 *  - `practice_facts` upserts ON CONFLICT DO NOTHING against UNIQUE(practice_id, field).
 *  - `contacts` writes fill NULL columns only — a stored email is never clobbered
 *    by a later run. "Never blindly overwrite a real record" is enforced in the
 *    WHERE clause, not by convention.
 *
 * Every fact written here carries an `evidence` row (source URL + snippet +
 * detected_at). A fact with no evidence cannot be written: `practice_facts.evidence_id`
 * is NOT NULL, so D2's citation contract is a database constraint, not a habit.
 */

export type EnrichmentProvider =
  | "claude_research"
  | "pdl"
  | "prospeo"
  | "fullenrich"
  | "bettercontact"
  | "website_scrape"
  | "org_website";

export type BuyerTier = "A" | "B" | "C" | "D" | "E" | "X" | "none";
export type SelectedContactClassification =
  | "best_buyer"
  | "reachable_fallback"
  | "weak_unrelated"
  | "none";
export type EmailQuality =
  | "safe_work"
  | "weak_work"
  | "personal"
  | "org_inbox"
  | "none";

export interface FactInput {
  field: string;
  value: string;
  sourceUrl: string;
  snippet: string;
  confidence?: number | null;
}

export interface UpsertFactArgs extends FactInput {
  practiceId: string;
  provider: EnrichmentProvider;
  detectedAt: Date;
}

export type UpsertFactResult =
  | { status: "written"; factId: string; evidenceId: string }
  | { status: "duplicate" };

/**
 * Write one cited fact. Evidence first (so the FK exists), then the fact. On a
 * (practice, field) conflict the fact is left alone — the first citation wins and
 * the AE keeps clicking a link that still supports the claim they read.
 *
 * Wrapped in a transaction so a conflicting fact does not strand an orphan
 * evidence row.
 */
export async function upsertPracticeFact(
  db: Database,
  args: UpsertFactArgs,
): Promise<UpsertFactResult> {
  return db.transaction(async (tx): Promise<UpsertFactResult> => {
    const existing = await tx
      .select({ id: practiceFacts.id })
      .from(practiceFacts)
      .where(
        and(
          eq(practiceFacts.practiceId, args.practiceId),
          eq(practiceFacts.field, args.field),
        ),
      )
      .limit(1);
    if (existing.length > 0) return { status: "duplicate" };

    const [ev] = await tx
      .insert(evidence)
      .values({
        sourceUrl: args.sourceUrl,
        snippet: args.snippet,
        confidence:
          args.confidence === null || args.confidence === undefined
            ? null
            : String(args.confidence),
        detectedAt: args.detectedAt,
      })
      .returning({ id: evidence.id });

    const inserted = await tx
      .insert(practiceFacts)
      .values({
        practiceId: args.practiceId,
        field: args.field,
        value: args.value,
        evidenceId: ev.id,
        provider: args.provider,
      })
      .onConflictDoNothing({
        target: [practiceFacts.practiceId, practiceFacts.field],
      })
      .returning({ id: practiceFacts.id });

    if (inserted.length === 0) {
      // Lost a race between the SELECT and the INSERT. Roll back the orphan
      // evidence row by failing the transaction? No — the fact is what matters,
      // and the evidence row is harmless. Report the duplicate honestly.
      return { status: "duplicate" };
    }
    return { status: "written", factId: inserted[0].id, evidenceId: ev.id };
  });
}

export interface ContactInput {
  practiceId: string;
  role: string;
  /** null = the role-only variant (D9's honest fallback). */
  name?: string | null;
  email?: string | null;
  emailProvider?: EnrichmentProvider | null;
  emailQuality?: EmailQuality | null;
  linkedinUrl?: string | null;
  linkedinProvider?: EnrichmentProvider | null;
  personProvider?: EnrichmentProvider | null;
  buyerTier?: BuyerTier | null;
  selectedContactClassification?: SelectedContactClassification | null;
  fallbackReason?: string | null;
  personalizationSnippet?: string | null;
  /** The page Claude cited for the name/role. */
  sourceUrl?: string | null;
}

export type UpsertContactResult = {
  contactId: string;
  created: boolean;
  filled: string[];
};

export type StoredContact = typeof contacts.$inferSelect;

/**
 * The stored contact for this practice + role, or null. Read BEFORE the waterfall
 * spends on PDL: `upsertContact` fills NULL columns only, so buying a field the row
 * already holds produces a value that is written nowhere. Idempotent on data is not
 * enough — a re-run must be idempotent on SPEND too.
 *
 * Keyed on the SAME (practice_id, role) tuple `upsertContact` writes on, and that is
 * load-bearing. `role` is free text from the model and `contacts` carries no unique
 * constraint, so a re-run whose role drifts ("Practice Administrator" -> "Practice
 * Manager") INSERTS a second row. Reading by practice_id alone would let the old
 * row's email suppress the PDL call, and the new row would be written empty — the
 * cost guard silently eating the data it was meant to protect.
 */
export async function getContact(
  db: Database,
  practiceId: string,
  role: string,
): Promise<StoredContact | null> {
  const [row] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.practiceId, practiceId), eq(contacts.role, role)))
    .limit(1);
  return row ?? null;
}

/**
 * Upsert the practice's decision-maker, keyed on (practice_id, role). No unique
 * constraint exists on `contacts`, so this is an explicit check-existence-then-write
 * inside a transaction — the same guarantee, stated where a reader can see it.
 *
 * On an existing contact only NULL columns are filled (`WHERE email IS NULL`).
 * That is the whole point of the waterfall: PDL is allowed to fill the email gap
 * Claude left, and is never allowed to replace an email Claude cited to a page.
 */
export async function upsertContact(
  db: Database,
  input: ContactInput,
): Promise<UpsertContactResult> {
  return db.transaction(async (tx): Promise<UpsertContactResult> => {
    const [existing] = await tx
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.practiceId, input.practiceId),
          eq(contacts.role, input.role),
        ),
      )
      .limit(1);

    if (!existing) {
      const [row] = await tx
        .insert(contacts)
        .values({
          practiceId: input.practiceId,
          role: input.role,
          name: input.name ?? null,
          email: input.email ?? null,
          emailProvider: input.emailProvider ?? null,
          emailQuality: input.emailQuality ?? null,
          linkedinUrl: input.linkedinUrl ?? null,
          linkedinProvider: input.linkedinProvider ?? null,
          personProvider: input.personProvider ?? null,
          buyerTier: input.buyerTier ?? null,
          selectedContactClassification:
            input.selectedContactClassification ?? null,
          fallbackReason: input.fallbackReason ?? null,
          personalizationSnippet: input.personalizationSnippet ?? null,
          sourceUrl: input.sourceUrl ?? null,
        })
        .returning({ id: contacts.id });
      return { contactId: row.id, created: true, filled: [] };
    }

    const filled: string[] = [];
    if (input.email && existing.email === null) {
      await tx
        .update(contacts)
        .set({
          email: input.email,
          emailProvider: input.emailProvider ?? null,
          emailQuality: input.emailQuality ?? null,
        })
        .where(and(eq(contacts.id, existing.id), isNull(contacts.email)));
      filled.push("email");
    }
    if (input.linkedinUrl && existing.linkedinUrl === null) {
      await tx
        .update(contacts)
        .set({
          linkedinUrl: input.linkedinUrl,
          linkedinProvider: input.linkedinProvider ?? null,
        })
        .where(and(eq(contacts.id, existing.id), isNull(contacts.linkedinUrl)));
      filled.push("linkedinUrl");
    }
    if (input.personProvider && existing.personProvider === null) {
      await tx
        .update(contacts)
        .set({ personProvider: input.personProvider })
        .where(and(eq(contacts.id, existing.id), isNull(contacts.personProvider)));
      filled.push("personProvider");
    }
    if (input.buyerTier && existing.buyerTier === null) {
      await tx
        .update(contacts)
        .set({ buyerTier: input.buyerTier })
        .where(and(eq(contacts.id, existing.id), isNull(contacts.buyerTier)));
      filled.push("buyerTier");
    }
    if (
      input.selectedContactClassification &&
      existing.selectedContactClassification === null
    ) {
      await tx
        .update(contacts)
        .set({
          selectedContactClassification: input.selectedContactClassification,
        })
        .where(
          and(
            eq(contacts.id, existing.id),
            isNull(contacts.selectedContactClassification),
          ),
        );
      filled.push("selectedContactClassification");
    }
    if (input.fallbackReason && existing.fallbackReason === null) {
      await tx
        .update(contacts)
        .set({ fallbackReason: input.fallbackReason })
        .where(and(eq(contacts.id, existing.id), isNull(contacts.fallbackReason)));
      filled.push("fallbackReason");
    }
    if (input.name && existing.name === null) {
      await tx
        .update(contacts)
        .set({ name: input.name })
        .where(and(eq(contacts.id, existing.id), isNull(contacts.name)));
      filled.push("name");
    }
    return { contactId: existing.id, created: false, filled };
  });
}

export type EnrichmentStatus = "pending" | "enriched" | "failed";

/** Reuses the existing enum. A practice mid-waterfall stays `pending` (no new value). */
export async function setEnrichmentStatus(
  db: Database,
  practiceId: string,
  status: EnrichmentStatus,
): Promise<void> {
  await db
    .update(practices)
    .set({ enrichmentStatus: status })
    .where(eq(practices.id, practiceId));
}

export async function fillPracticeSocialLinks(
  db: Database,
  practiceId: string,
  social: { linkedinUrl?: string | null; facebookUrl?: string | null; instagramUrl?: string | null },
): Promise<string[]> {
  const filled: string[] = [];
  const [existing] = await db
    .select({
      linkedinUrl: practices.companyLinkedinUrl,
      facebookUrl: practices.companyFacebookUrl,
      instagramUrl: practices.companyInstagramUrl,
    })
    .from(practices)
    .where(eq(practices.id, practiceId))
    .limit(1);
  if (!existing) return filled;

  const patch: Partial<typeof practices.$inferInsert> = {};
  if (social.linkedinUrl && existing.linkedinUrl === null) {
    patch.companyLinkedinUrl = social.linkedinUrl;
    filled.push("companyLinkedinUrl");
  }
  if (social.facebookUrl && existing.facebookUrl === null) {
    patch.companyFacebookUrl = social.facebookUrl;
    filled.push("companyFacebookUrl");
  }
  if (social.instagramUrl && existing.instagramUrl === null) {
    patch.companyInstagramUrl = social.instagramUrl;
    filled.push("companyInstagramUrl");
  }
  if (filled.length > 0) {
    await db.update(practices).set(patch).where(eq(practices.id, practiceId));
  }
  return filled;
}
