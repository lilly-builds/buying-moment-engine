import { asc, eq } from "drizzle-orm";
import { contacts, evidence, practiceFacts, practices, signals } from "@/db/schema";
import type { Database } from "@/db/types";
import { isFresh } from "@/src/engine/freshness";
import { getPack, PACK_VERTICALS, type PackVertical, type VerticalPack } from "@/src/packs";
import type { DetectorKind } from "@/src/ingest/validate";
import type { GroundingParts } from "./lint";

/**
 * Everything the brief is allowed to know, read once, in one place (U6).
 *
 * This module is the boundary that makes the hallucination guard MEAN something. The
 * synthesizer's prompt is built from `BriefInput` and nothing else, and the grounding
 * corpus (`lint.ts`) is built from the same object. If a fact is not here, the model
 * never saw it, and any sentence containing it is a fabrication by construction rather
 * than by inspection.
 *
 * Every fact carries the `evidence` row that proves it. `practice_facts.evidence_id` and
 * `signals.evidence_id` are both NOT NULL, so an uncited fact cannot be read out of the
 * database because it could not be written into it (D2 as a schema constraint, U5).
 */

/** The citation atom, straight off the `evidence` row. Never synthesized. */
export interface EvidenceRef {
  id: string;
  sourceUrl: string;
  /** Nullable in the column. A fact with no snippet still links to its page, just not to the sentence. */
  snippet: string | null;
  detectedAt: Date;
  confidence: number | null;
}

/** One `practice_facts` row joined to the evidence that proves it. */
export interface FactRow {
  /** `specialty` | `website` | `yearFounded` | `ehr` | `incumbent_tooling_N` | `buying_moment_N`. */
  field: string;
  value: string;
  provider: "claude_research" | "pdl";
  evidence: EvidenceRef;
}

/** One fired signal joined to its evidence. Drives the buying-moment headline. */
export interface SignalRow {
  kind: DetectorKind;
  signalSource: string | null;
  detectedAt: Date;
  expiresAt: Date | null;
  confidence: number | null;
  evidence: EvidenceRef;
}

export interface ContactRow {
  name: string | null;
  role: string;
  email: string | null;
  emailProvider: "claude_research" | "pdl" | null;
  linkedinUrl: string | null;
  bestChannel: string | null;
  sourceUrl: string | null;
}

export interface BriefInput {
  practice: {
    id: string;
    name: string;
    city: string | null;
    state: string | null;
    vertical: PackVertical;
  };
  facts: FactRow[];
  signals: SignalRow[];
  contact: ContactRow | null;
  pack: VerticalPack;
}

/**
 * Why a practice cannot be briefed. Both are honest states, not errors — a caller
 * renders them, it does not retry them.
 */
export type BriefInputFailure =
  /** No such practice id. */
  | { reason: "practice-not-found" }
  /**
   * The classifier could not resolve a specialty, so there is no vertical pack — no
   * pain line, no opener language, no proof point. `db/queries.ts#feedPractices` keeps
   * these out of the feed for exactly this reason; briefing one would mean guessing a
   * vertical and handing an AE the wrong pitch (R6, U5).
   */
  | { reason: "unclassified-vertical" };

export type BriefInputResult =
  | { ok: true; input: BriefInput }
  | ({ ok: false } & BriefInputFailure);

function isPackVertical(value: string): value is PackVertical {
  return (PACK_VERTICALS as readonly string[]).includes(value);
}

/** `numeric` columns come back as strings from postgres. Null stays null. */
function toNumber(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Read the whole brief input for one practice.
 *
 * Facts and signals are ordered deterministically (`field`, then `kind` + `detected_at`)
 * so two runs over the same rows build the same prompt. That is not cosmetic: the
 * Anthropic prompt cache is a prefix match, and an unordered `SELECT` would silently
 * re-write the cache on every call. It also makes a golden-fixture test possible at all.
 */
export async function buildBriefInput(
  db: Database,
  practiceId: string,
): Promise<BriefInputResult> {
  const [practice] = await db
    .select({
      id: practices.id,
      name: practices.name,
      city: practices.city,
      state: practices.state,
      vertical: practices.vertical,
    })
    .from(practices)
    .where(eq(practices.id, practiceId))
    .limit(1);

  if (!practice) return { ok: false, reason: "practice-not-found" };
  if (!isPackVertical(practice.vertical)) {
    return { ok: false, reason: "unclassified-vertical" };
  }

  const factRows = await db
    .select({
      field: practiceFacts.field,
      value: practiceFacts.value,
      provider: practiceFacts.provider,
      evidenceId: evidence.id,
      sourceUrl: evidence.sourceUrl,
      snippet: evidence.snippet,
      detectedAt: evidence.detectedAt,
      confidence: evidence.confidence,
    })
    .from(practiceFacts)
    .innerJoin(evidence, eq(practiceFacts.evidenceId, evidence.id))
    .where(eq(practiceFacts.practiceId, practiceId))
    .orderBy(asc(practiceFacts.field));

  const signalRows = await db
    .select({
      kind: signals.kind,
      signalSource: signals.signalSource,
      detectedAt: signals.detectedAt,
      expiresAt: signals.expiresAt,
      signalConfidence: signals.confidence,
      evidenceId: evidence.id,
      sourceUrl: evidence.sourceUrl,
      snippet: evidence.snippet,
      evidenceDetectedAt: evidence.detectedAt,
      evidenceConfidence: evidence.confidence,
    })
    .from(signals)
    .innerJoin(evidence, eq(signals.evidenceId, evidence.id))
    .where(eq(signals.practiceId, practiceId))
    .orderBy(asc(signals.kind), asc(signals.detectedAt), asc(evidence.id));

  // A practice has at most one contact row per role, and U5 writes exactly one
  // decision-maker. `limit(1)` with a stable order rather than an unordered read.
  const [contact] = await db
    .select({
      name: contacts.name,
      role: contacts.role,
      email: contacts.email,
      emailProvider: contacts.emailProvider,
      linkedinUrl: contacts.linkedinUrl,
      bestChannel: contacts.bestChannel,
      sourceUrl: contacts.sourceUrl,
    })
    .from(contacts)
    .where(eq(contacts.practiceId, practiceId))
    .orderBy(asc(contacts.role))
    .limit(1);

  return {
    ok: true,
    input: {
      practice: { ...practice, vertical: practice.vertical },
      facts: factRows.map((row) => ({
        field: row.field,
        value: row.value,
        provider: row.provider,
        evidence: {
          id: row.evidenceId,
          sourceUrl: row.sourceUrl,
          snippet: row.snippet,
          detectedAt: row.detectedAt,
          confidence: toNumber(row.confidence),
        },
      })),
      signals: signalRows.map((row) => ({
        kind: row.kind,
        signalSource: row.signalSource,
        detectedAt: row.detectedAt,
        expiresAt: row.expiresAt,
        confidence: toNumber(row.signalConfidence),
        evidence: {
          id: row.evidenceId,
          sourceUrl: row.sourceUrl,
          snippet: row.snippet,
          detectedAt: row.evidenceDetectedAt,
          confidence: toNumber(row.evidenceConfidence),
        },
      })),
      contact: contact ?? null,
      pack: getPack(practice.vertical),
    },
  };
}

/**
 * Signals still inside their freshness window at `now`.
 *
 * Everything downstream reads THIS, never `input.signals`. A signal past its window is
 * not a buying moment, and a brief built on one would open with urgency that expired —
 * which is the precise failure the KTD ("a stored brief can never claim '3 signals
 * firing' after one has expired") exists to prevent. It is also why the brief's
 * fingerprint is taken over the fresh set: an expiry then *changes* the fingerprint, and
 * `isBriefStale()` can see it without a scheduler ever running.
 */
export function freshSignals(rows: readonly SignalRow[], now: Date): SignalRow[] {
  return rows.filter((row) => isFresh(row.expiresAt, now));
}

/** Distinct fired signal kinds, sorted. The derived count R1 ranks the feed on. */
export function firedSignalKinds(rows: readonly SignalRow[]): DetectorKind[] {
  return [...new Set(rows.map((row) => row.kind))].sort();
}

/**
 * Every evidence id the model is permitted to cite. `citationClosure()` rejects any
 * other id, so this set is the entire universe of things the brief may attribute a
 * claim to.
 *
 * Takes the signals the caller actually showed the model — the FRESH ones. Passing the
 * full set would let the model cite a signal that has expired out of the brief.
 */
export function allowedEvidenceIds(
  facts: readonly FactRow[],
  signalRows: readonly SignalRow[],
): Set<string> {
  return new Set([
    ...facts.map((fact) => fact.evidence.id),
    ...signalRows.map((signal) => signal.evidence.id),
  ]);
}

/**
 * Every string a number in the brief may legitimately have come from, split into what may
 * be asserted about THIS practice (`evidence`) and the pack's own cited figures (`pack`,
 * allowed only inside a rebuttal). See `lint.ts#GroundingParts` for why the split exists.
 *
 * Takes the FRESH signals the caller actually showed the model, never `input.signals`: a
 * digit that lives only in an expired signal's snippet grounds prose the model never saw
 * (P2-5).
 *
 * The `evidence` bucket deliberately excludes the contact's email and LinkedIn URL (a digit
 * inside `jsmith2@clinic.com` would ground the statistic "2"), and now also the `website`
 * fact's VALUE for the same reason — a URL is an address, not a measurement. Its snippet
 * stays: that is real page text the model was shown. `ehrSignals[].name` is dropped from the
 * corpus entirely — it is never shown to the model, so it can ground nothing (P1-3, P2-5).
 */
export function groundingParts(
  input: BriefInput,
  signals: readonly SignalRow[],
): GroundingParts {
  const pack = input.pack;
  return {
    evidence: [
      input.practice.name,
      input.practice.city,
      input.practice.state,
      ...input.facts.flatMap((fact) =>
        fact.field === "website" ? [fact.evidence.snippet] : [fact.value, fact.evidence.snippet],
      ),
      ...signals.map((signal) => signal.evidence.snippet),
    ],
    pack: [
      pack.painFit.line,
      pack.opener.exampleOpener,
      ...pack.opener.vocabulary,
      ...(pack.proofPoint.tag === "real"
        ? [pack.proofPoint.caseStudy, ...pack.proofPoint.metrics]
        : []),
      ...pack.roiBenchmark.items.map((item) => item.label),
    ],
  };
}
