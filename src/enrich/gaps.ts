import type { FactInput } from "@/db/enrich";
import type { ResearchFindings } from "./types";

/**
 * The waterfall's PURE half: what did Claude leave for PDL, and what gets
 * persisted. Kept out of `waterfall.ts` so the cost guard is provable without a
 * database, a mock, or a fixture — `tests/enrich/waterfall.test.ts` calls these
 * directly. A guard that can only be tested through an integration test is a
 * guard that quietly rots.
 */

export interface Gaps {
  email: boolean;
  linkedinUrl: boolean;
}

/**
 * Does PDL have anything to do? PDL's Person Enrichment keys on a person's NAME +
 * company; it cannot answer "who runs this practice?" from the company alone. So:
 *  - no decision-maker, or a role with no name -> no gap, ZERO PDL calls, and the
 *    contact degrades to D9's role-only variant.
 *  - a named contact -> PDL fills only the fields Claude did not cite.
 */
export function computeGaps(findings: ResearchFindings): Gaps {
  const dm = findings.decisionMaker;
  if (!dm || !dm.name) return { email: false, linkedinUrl: false };
  return { email: dm.email === null, linkedinUrl: dm.linkedinUrl === null };
}

export function hasGap(gaps: Gaps): boolean {
  return gaps.email || gaps.linkedinUrl;
}

/** The subset of a stored `contacts` row that can close a gap. */
export interface StoredContactFields {
  email: string | null;
  linkedinUrl: string | null;
}

/**
 * Subtract what the DATABASE already holds from what Claude left blank.
 *
 * `computeGaps` sees only the FRESH findings, so a re-run of the same practice
 * re-opens the email gap Claude never fills, calls PDL again (real money), and then
 * `upsertContact`'s fill-NULL-only write silently discards the result. Idempotent on
 * data, wasteful on spend. Netting the stored row out of the gaps closes that.
 */
export function subtractFilled(
  gaps: Gaps,
  existing: StoredContactFields | null,
): Gaps {
  if (!existing) return gaps;
  return {
    email: gaps.email && existing.email === null,
    linkedinUrl: gaps.linkedinUrl && existing.linkedinUrl === null,
  };
}

/**
 * Flatten findings into the cited facts we persist. Firmographics, EHR, incumbent
 * tooling and buying-moment context all land in `practice_facts`, each with its own
 * evidence row. The decision-maker lands on `contacts`.
 */
export function factsFromFindings(findings: ResearchFindings): FactInput[] {
  const facts: FactInput[] = [];
  for (const [field, fact] of Object.entries(findings.firmographics)) {
    facts.push({ field, ...fact });
  }
  if (findings.ehr) facts.push({ field: "ehr", ...findings.ehr });
  findings.incumbentTooling.forEach((fact, i) => {
    facts.push({ field: `incumbent_tooling_${i + 1}`, ...fact });
  });
  findings.buyingMomentContext.forEach((fact, i) => {
    facts.push({ field: `buying_moment_${i + 1}`, ...fact });
  });
  return facts;
}
