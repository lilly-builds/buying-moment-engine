import type { VerticalPack } from "@/src/packs";
import { citationHref, facebookHref, linkedinHref } from "./citation-link";
import { BRIEF_SCHEMA_VERSION } from "./config";
import { firedSignalKinds, freshSignals, type BriefInput, type ContactRow, type FactRow, type SignalRow } from "./inputs";
import {
  ZERO_SIGNAL_HEADLINE,
  type Claim,
  type ContactCard,
  type FactualBrief,
  type ProofPointCard,
  type RoiRangeCard,
} from "./schema";

/**
 * Stage 1 of the two-stage brief (U6): **the factual half, assembled in code.**
 *
 * Nothing here asks a model anything. Practice profile, incumbent tooling, proof point,
 * ROI range and the contact card are built directly from `practice_facts` rows, their
 * `evidence` rows, and the vertical pack — each carrying the evidence id and source URL
 * that proves it. The LLM never sees a chance to restate them, so it never gets a chance
 * to restate them wrong.
 *
 * This is the architecture the repo already committed to, and U5 had to be dragged back
 * into compliance with it once: `locationsCount` and `providerCount` were LLM-cited
 * fields until the citation verifier caught the model stitching snippets to justify a
 * tally it had done itself. Counts are code's job. So is everything in this file.
 *
 * PURE: no I/O, no clock read except the `now` a caller passes in. `assembleFactual` is
 * a function of (rows, pack, now) and unit-tests with no database.
 */

/**
 * Human labels for the fixed `practice_facts.field` keys U5 writes. A card row reads
 * "Specialty: Dermatology", never "specialty: Dermatology" and never a raw column name.
 */
const PROFILE_FIELDS: Record<string, string> = {
  specialty: "Specialty",
  website: "Website",
  yearFounded: "Founded",
};

const EHR_FIELD = "ehr";
const INCUMBENT_TOOLING_PREFIX = "incumbent_tooling_";
const BUYING_MOMENT_PREFIX = "buying_moment_";

/**
 * `incumbent_tooling_2` sorts before `incumbent_tooling_10` numerically and after it
 * lexicographically. The DB hands us `ORDER BY field`, so re-sort the indexed families
 * on their numeric suffix — otherwise the card's row order flips the moment a practice
 * has ten of anything, and a golden fixture starts failing for no reason a reader can see.
 */
function indexOfField(field: string, prefix: string): number {
  const suffix = Number(field.slice(prefix.length));
  return Number.isFinite(suffix) ? suffix : Number.MAX_SAFE_INTEGER;
}

function byFieldIndex(prefix: string) {
  return (a: FactRow, b: FactRow) =>
    indexOfField(a.field, prefix) - indexOfField(b.field, prefix);
}

/**
 * One stored fact becomes one rendered claim.
 *
 * `quote` is the evidence snippet — the page's own words, and the ONLY part of a claim
 * that may be rendered inside quotation marks (see `schema.ts`). `href` carries the
 * snippet into a scroll-to-text fragment, so the AE's click lands on that sentence
 * rather than on the top of a staff page they then have to skim.
 *
 * That link is trustworthy for exactly one reason: `src/enrich/citations.ts` already
 * proved the snippet is a verbatim, contiguous substring of the page at `sourceUrl`.
 * We never build a fragment out of text we have not proved is there.
 */
function toClaim(label: string, fact: FactRow): Claim {
  return {
    label,
    value: fact.value,
    evidenceId: fact.evidence.id,
    sourceUrl: fact.evidence.sourceUrl,
    quote: fact.evidence.snippet,
    href: citationHref(fact.evidence.sourceUrl, fact.evidence.snippet),
  };
}

/**
 * The pack's proof point, or the explicit `proof_pending` sentinel (U7) which renders
 * "Proof pending — no customer success metrics found." A pack cannot reach here with a
 * silently blank proof; the loader rejects that.
 *
 * The link is the bare case-study URL, NOT a text fragment. The pack's `metrics` are
 * U13's summaries of the case study, not spans lifted out of it, so a fragment built
 * from one would simply never match. A fragment we cannot justify is a fragment that
 * quietly does nothing — and the fact that it degrades silently is exactly why it must
 * not be added on a guess.
 */
function toProofPointCard(pack: VerticalPack): ProofPointCard {
  if (pack.proofPoint.tag === "proof_pending") return { tag: "proof_pending" };
  return {
    tag: "real",
    caseStudy: pack.proofPoint.caseStudy,
    metrics: [...pack.proofPoint.metrics],
    sourceUrl: pack.proofPoint.sourceUrl,
    href: citationHref(pack.proofPoint.sourceUrl, null),
  };
}

/** ROI stays tagged `modeled` all the way to the card (D10): projected, never measured here. */
function toRoiRangeCard(pack: VerticalPack): RoiRangeCard {
  return {
    tag: "modeled",
    items: pack.roiBenchmark.items.map((item) => ({
      label: item.label,
      sourceUrl: item.sourceUrl,
      href: citationHref(item.sourceUrl, null),
    })),
  };
}

/**
 * Which channel to open on. `contacts.best_channel` is nullable and U5 never populates
 * it, so we derive it from what we actually hold — email if we have an address, else
 * LinkedIn if we have a profile, else the phone.
 *
 * This is a statement about OUR reach, not a claim about the practice, so it needs no
 * citation. Naming that distinction matters: every other field on this card is a claim
 * and does.
 */
function deriveBestChannel(contact: ContactRow): string {
  if (contact.bestChannel) return contact.bestChannel;
  if (contact.email) return "email";
  if (contact.linkedinUrl) return "linkedin";
  return "phone";
}

/**
 * The who-to-contact card, degrading down D9's ladder rather than failing.
 *
 * `role_only` was the MAJORITY outcome on U5's cohort — 3 of 5 practices returned no
 * named person, including a one-location practice, which killed the "small practice =>
 * findable owner-physician" generalization. So this is the common path. The name is
 * simply absent; nothing invents one, and the LinkedIn/Facebook buttons fall back to a
 * people-search scoped to the practice.
 */
function toContactCard(contact: ContactRow, practiceName: string): ContactCard {
  return {
    variant: contact.name ? "named" : "role_only",
    name: contact.name,
    role: contact.role,
    email: contact.email,
    emailProvider: contact.emailProvider,
    linkedinUrl: contact.linkedinUrl,
    bestChannel: deriveBestChannel(contact),
    sourceUrl: contact.sourceUrl,
    // No text fragment: `contacts` stores the page that named the role, not the sentence.
    sourceHref: contact.sourceUrl ? citationHref(contact.sourceUrl, null) : null,
    linkedinHref: linkedinHref(contact.linkedinUrl, contact.name, practiceName),
    facebookHref: facebookHref(contact.name, practiceName),
  };
}

/**
 * A stable snapshot of which signals were firing when the prose was written, as sorted
 * `"<kind>:<evidenceId>"` strings. Taken over the FRESH set, so a signal ageing out of
 * its window changes the fingerprint and `isBriefStale()` sees it.
 *
 * Never rendered. The count, the fired-signal list and the freshness badge are all read
 * from the `signals` table at render time.
 */
export function signalFingerprint(rows: readonly SignalRow[]): string[] {
  return rows.map((row) => `${row.kind}:${row.evidence.id}`).sort();
}

export interface AssembleResult {
  factual: FactualBrief;
  /** The fresh signals the model will be shown. Everything downstream reads this. */
  signals: SignalRow[];
}

/**
 * Build the factual tier. `now` decides which signals are still inside their freshness
 * window — inject it; do not read the clock here.
 */
export function assembleFactual(input: BriefInput, now: Date): AssembleResult {
  const signals = freshSignals(input.signals, now);
  const zeroSignal = firedSignalKinds(signals).length === 0;

  const profile = Object.entries(PROFILE_FIELDS).flatMap(([field, label]) => {
    const fact = input.facts.find((row) => row.field === field);
    return fact ? [toClaim(label, fact)] : [];
  });

  const ehr = input.facts.filter((row) => row.field === EHR_FIELD);
  const tooling = input.facts
    .filter((row) => row.field.startsWith(INCUMBENT_TOOLING_PREFIX))
    .sort(byFieldIndex(INCUMBENT_TOOLING_PREFIX));

  const buyingMomentContext = input.facts
    .filter((row) => row.field.startsWith(BUYING_MOMENT_PREFIX))
    .sort(byFieldIndex(BUYING_MOMENT_PREFIX))
    .map((fact) => toClaim("Buying-moment context", fact));

  return {
    signals,
    factual: {
      schemaVersion: BRIEF_SCHEMA_VERSION,
      vertical: input.practice.vertical,
      practiceName: input.practice.name,
      city: input.practice.city,
      state: input.practice.state,
      zeroSignal,
      // The absence of a buying moment is phrased in code, never by the model — the only
      // way to phrase it wrongly is to invent one (U8's zero-signal variant).
      headline: zeroSignal ? ZERO_SIGNAL_HEADLINE : null,
      profile,
      // An empty array renders as an omitted section. The EHR is unsolved for everyone
      // (U5: never found, n=7; see docs/ehr-signal-recon.md), so this is routinely empty
      // and must read as absence — never as "Unknown", which is a claim we cannot cite.
      incumbentTooling: [
        ...ehr.map((fact) => toClaim("EHR", fact)),
        ...tooling.map((fact) => toClaim("Incumbent tooling", fact)),
      ],
      buyingMomentContext,
      painFit: input.pack.painFit.line,
      proofPoint: toProofPointCard(input.pack),
      roiRange: toRoiRangeCard(input.pack),
      contact: input.contact ? toContactCard(input.contact, input.practice.name) : null,
      signalFingerprint: signalFingerprint(signals),
    },
  };
}
