import { createHash } from "node:crypto";
import {
  normalizeName,
  type DetectorKind,
  type RawSignalInput,
} from "@/src/ingest/validate";
import type { Meter } from "@/src/roi/cost-meter";

/**
 * Detector framework (R3/R5/R7) — the ONE interface every signal detector
 * implements: fetch -> normalize -> emit `SignalCandidate`. Detectors stay small
 * and swappable; this framework owns the heavy lifting (deterministic dedupe
 * keys, freshness, persistence, error isolation) so a detector never re-invents
 * any of it. D9 binds: candidates carry only public BUSINESS signals — zero PHI.
 */

export type { DetectorKind };

/**
 * One citation atom (R5). Every emitted claim carries its own source URL so the
 * citation contract survives all the way to the stored evidence row.
 */
export interface CandidateEvidence {
  claim: string;
  sourceUrl: string;
  snippet?: string;
  /** 0..1; when absent the candidate-level confidence is used for this atom. */
  confidence?: number;
}

/** What a detector emits — normalized, not yet persisted. */
export interface SignalCandidate {
  practiceHint: string;
  kind: DetectorKind;
  evidence: CandidateEvidence[];
  confidence: number; // 0..1
  detectedAt: Date;
  geoKey?: string;
  /** Optional specialty tag when a source's own text makes it clear. */
  vertical?: "dermatology" | "womens_health" | "ophthalmology" | "orthopedics";
  /**
   * The practice's own homepage, when the lead SOURCE hands it to us for free
   * (R-W1) — e.g. Google Places Details returns `website` on the call the detector
   * already pays for. Captured here so it flows through ingest to the practice as
   * the lead is found, seeding enrichment's scrape. Optional: a source without a
   * website (Adzuna, GDELT) simply omits it, and a deliberate Places name-lookup
   * fills the gap later (Plan B, `src/enrich/website.ts`).
   */
  website?: string;
}

/**
 * Context handed to each detector on a run. `meter` lets a detector wrap its own
 * paid fetches (R19) — the framework makes no paid calls itself, it just doesn't
 * block a detector from receiving one. `now` is injected so runs are reproducible.
 */
export interface DetectorContext {
  now: Date;
  meter?: Meter;
}

/** The single interface a U4 detector implements. */
export interface Detector {
  readonly kind: DetectorKind;
  /** Stable human name — used in the run summary and error logs, never a UUID. */
  readonly name: string;
  detect(ctx: DetectorContext): Promise<SignalCandidate[]>;
}

/**
 * Deterministic dedupe key: sha256 of `kind|sourceUrl|normalizedHint`. Explicit
 * and key-order-independent, so re-runs de-dupe correctly instead of leaning on
 * the ingest rail's key-order-sensitive JSON.stringify fallback (its TODO).
 */
export function candidateDedupeHash(
  kind: DetectorKind,
  sourceUrl: string,
  practiceHint: string,
): string {
  const canonical = `${kind}|${sourceUrl}|${normalizeName(practiceHint)}`;
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Flatten a candidate into one raw-signal input PER evidence atom — each carries
 * its own source URL, snippet, and confidence so the citation contract (R5)
 * flows through the ingest rail unchanged. Pure: no I/O, unit-testable with no
 * mocks. Persistence + freshness happen in the runner.
 */
export function candidateToRawSignals(
  candidate: SignalCandidate,
): RawSignalInput[] {
  return candidate.evidence.map((atom) => {
    const payload: Record<string, unknown> = {
      claim: atom.claim,
      confidence: atom.confidence ?? candidate.confidence,
    };
    if (atom.snippet !== undefined) payload.snippet = atom.snippet;
    // The source-provided website rides the payload (R-W1). Repeated on every atom
    // so it survives whichever atom promotes the practice first; the ingest rail's
    // ON CONFLICT DO NOTHING then keeps the first-seen value (never clobbers).
    if (candidate.website !== undefined) payload.website = candidate.website;
    if (candidate.vertical !== undefined) payload.vertical = candidate.vertical;

    const raw: RawSignalInput = {
      dedupeHash: candidateDedupeHash(
        candidate.kind,
        atom.sourceUrl,
        candidate.practiceHint,
      ),
      detectorKind: candidate.kind,
      payload,
      sourceUrl: atom.sourceUrl,
      practiceHint: candidate.practiceHint,
      detectedAt: candidate.detectedAt,
    };
    if (candidate.geoKey !== undefined) raw.geoKey = candidate.geoKey;
    return raw;
  });
}
