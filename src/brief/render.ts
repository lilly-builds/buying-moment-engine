import { freshnessWeight, isFresh, windowDaysFor } from "@/src/engine/freshness";
import type { DetectorKind } from "@/src/ingest/validate";
import { citationHref } from "./citation-link";
import { signalFingerprint } from "./assemble";
import { freshSignals, type SignalRow } from "./inputs";
import { ZERO_SIGNAL_HEADLINE, type FactualBrief, type StoredBrief, type VoiceBrief } from "./schema";

/**
 * Render-time assembly (U6, KTD): **the time-sensitive fields never persist.**
 *
 * A stored brief holds prose and cited facts. It does NOT hold the signal count, the
 * fired-signal list, or the freshness badge — those are computed here, from the `signals`
 * table, every time the card is opened. The failure this prevents is specific and
 * embarrassing: a brief generated on Monday that still says "3 signals firing" on Friday,
 * after two of them aged out of their windows.
 *
 * Reading them live costs one SQL query the feed already runs. It costs no LLM call: the
 * prose is not regenerated to redraw a badge. Lilly's ruling (2026-07-08) — "this would be
 * completely wasteful if we re-rendered" — holds, and it is satisfied by exactly this
 * split rather than by persisting the badge.
 *
 * PURE: no I/O. The caller supplies the rows and the clock.
 */

/** How stale a signal is allowed to look before the badge says so, in plain AE words. */
export type FreshnessTier = "today" | "this-week" | "this-month" | "ageing";

export interface FiredSignal {
  kind: DetectorKind;
  signalSource: string | null;
  detectedAt: Date;
  expiresAt: Date | null;
  /** Per-signal confidence badge (R4's call-prep tier). Null when the detector emitted none. */
  confidence: number | null;
  /** 1.0 at detection, sliding to 0.0 at expiry. Drives the feed's decayed rank. */
  freshnessWeight: number;
  evidenceId: string;
  sourceUrl: string;
  /** Deep link straight to the sentence that fired it — the AE verifies in one click. */
  href: string;
}

export interface LiveSignalView {
  /** Distinct fired signal KINDS, not evidence rows. This is what R1 ranks the feed on. */
  signalCount: number;
  firedSignals: FiredSignal[];
  freshness: FreshnessTier | null;
  /** The most recent detection across all fresh signals. Null when nothing is firing. */
  mostRecentDetectedAt: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Freshness is expressed as a HUMAN tier, not a raw age. An AE glancing at a card needs
 * "today" or "ageing", never "11.4 days". The tier reads off the most recent detection —
 * the buying moment is as fresh as its freshest evidence.
 */
export function freshnessTier(mostRecentDetectedAt: Date, now: Date): FreshnessTier {
  const ageDays = (now.getTime() - mostRecentDetectedAt.getTime()) / DAY_MS;
  if (ageDays < 1) return "today";
  if (ageDays < 7) return "this-week";
  if (ageDays < 30) return "this-month";
  return "ageing";
}

/**
 * Compute the live view from the signals table.
 *
 * `signalCount` counts distinct KINDS. Two staffing-spike postings are one signal, not
 * two — a practice with three job ads has not hit three buying moments, and ranking it
 * above a practice with three *different* signals would invert the whole thesis (R1, U5).
 */
export function liveSignalView(rows: readonly SignalRow[], now: Date): LiveSignalView {
  const fresh = freshSignals(rows, now);

  const firedSignals: FiredSignal[] = fresh.map((row) => ({
    kind: row.kind,
    signalSource: row.signalSource,
    detectedAt: row.detectedAt,
    expiresAt: row.expiresAt,
    confidence: row.confidence,
    freshnessWeight: freshnessWeight(row.detectedAt, row.expiresAt, now),
    evidenceId: row.evidence.id,
    sourceUrl: row.evidence.sourceUrl,
    href: citationHref(row.evidence.sourceUrl, row.evidence.snippet),
  }));

  const mostRecentDetectedAt = firedSignals.reduce<Date | null>(
    (latest, signal) =>
      latest === null || signal.detectedAt > latest ? signal.detectedAt : latest,
    null,
  );

  return {
    signalCount: new Set(fresh.map((row) => row.kind)).size,
    firedSignals,
    freshness: mostRecentDetectedAt ? freshnessTier(mostRecentDetectedAt, now) : null,
    mostRecentDetectedAt,
  };
}

export interface RenderedBrief {
  factual: FactualBrief;
  voice: VoiceBrief;
  /** Read live from `signals`, never from the stored JSON. */
  live: LiveSignalView;
  /** The live headline: the model's when a moment is firing, the constant otherwise. */
  headline: string;
  /**
   * The fresh signal set has diverged from what the prose was written against — a new
   * signal fired, or one expired past its window. A UI gates a "regenerate this brief"
   * affordance on this. It is a READ, not a scheduler (Lilly's ruling): nothing here
   * regenerates anything, and the card still renders honestly until it does.
   */
  stale: boolean;
}

/**
 * Merge a stored brief with the live signal view.
 *
 * The headline is the loudest claim on the card, so it is defended twice — code decides it,
 * the model never gets the final say. It falls back to the honest constant when the brief
 * was WRITTEN with no moment (`factual.zeroSignal` — belt behind the synthesizer's own
 * gate, P1-1) OR when every signal it was written against has since EXPIRED
 * (`live.signalCount === 0` — the KTD verbatim: "a stored brief must never claim a buying
 * moment that has expired", P1-2). Only a brief with a moment still live shows the model's
 * headline; and `voice.headline` is null on the zero-signal variant anyway, so even that
 * path cannot fall through to invented urgency.
 */
export function renderBrief(
  brief: StoredBrief,
  signalRows: readonly SignalRow[],
  now: Date,
): RenderedBrief {
  const live = liveSignalView(signalRows, now);
  return {
    factual: brief.factual,
    voice: brief.voice,
    live,
    headline:
      brief.factual.zeroSignal || live.signalCount === 0
        ? ZERO_SIGNAL_HEADLINE
        : (brief.voice.headline ?? ZERO_SIGNAL_HEADLINE),
    stale: isBriefStale(brief.factual, signalRows, now),
  };
}

/**
 * Has the buying moment changed since this prose was written?
 *
 * The KTD says regeneration triggers on a signal change, "including a signal expiring past
 * its freshness window." Both cases reduce to one string compare, because the stored
 * fingerprint was taken over the FRESH set at generation time: a new signal adds an entry,
 * and an expiring signal removes one.
 *
 * This is a PREDICATE, not a scheduler. Nothing here runs on a timer, nothing regenerates
 * anything. A caller that wants to refresh a brief asks this first and pays for one Opus
 * call only when the answer is yes. Per Lilly's ruling, no scheduler is built in U6.
 */
export function isBriefStale(
  brief: FactualBrief,
  signalRows: readonly SignalRow[],
  now: Date,
): boolean {
  const current = signalFingerprint(freshSignals(signalRows, now));
  const stored = brief.signalFingerprint;
  return current.length !== stored.length || current.some((entry, i) => entry !== stored[i]);
}

/**
 * When the next signal expires — the earliest moment `isBriefStale` could flip to true
 * without anything new being detected.
 *
 * Returned so a future refresh job (U15, or the monthly cadence Lilly mentioned) can be
 * scheduled off real data instead of a guessed interval. Null means nothing is firing, or
 * nothing carries an expiry.
 */
export function nextExpiryAt(rows: readonly SignalRow[], now: Date): Date | null {
  return freshSignals(rows, now)
    .map((row) => row.expiresAt)
    .filter((expiry): expiry is Date => expiry !== null)
    .reduce<Date | null>(
      (earliest, expiry) => (earliest === null || expiry < earliest ? expiry : earliest),
      null,
    );
}

/** Re-exported so a UI can explain a badge ("front-desk hiring stays hot for 30 days"). */
export { isFresh, windowDaysFor };
