import { freshnessWeight } from "./freshness";

/**
 * Scoring (R3 + feed rank) — PURE ranking helpers, no I/O, no DB. The feed later
 * orders practices by their signals' decayed scores; keeping this math pure means
 * "a stale signal decays in rank" is provable in a unit test with no database.
 */

/** Coerce any detector-supplied confidence into a safe [0,1]. NaN/Inf -> 0. */
export function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export interface ScoreInput {
  confidence: number;
  detectedAt: Date;
  expiresAt: Date | null | undefined;
  now: Date;
}

/**
 * Freshness-decayed rank score = clamped confidence x freshness weight. A signal
 * past its window scores 0 no matter how confident, so the feed never ranks a
 * dead signal above a live one.
 */
export function decayedScore(input: ScoreInput): number {
  return (
    clampConfidence(input.confidence) *
    freshnessWeight(input.detectedAt, input.expiresAt, input.now)
  );
}

/** Comparator for `Array.sort` — highest decayed score first (descending). */
export function compareByScore(a: ScoreInput, b: ScoreInput): number {
  return decayedScore(b) - decayedScore(a);
}
