/**
 * proof-format — one honest way to join a proof result and its number.
 *
 * A claim a user typed can end in a sentence mark ("...at a 200-person company.").
 * Appending the metric with a raw separator then reads "...company.: 40% faster
 * ramp" — a period immediately followed by a colon. This trims a single trailing
 * run of sentence punctuation (". , ; :") off the claim before joining, so the
 * line always uses exactly one clean separator.
 *
 * Pure and dependency-free on purpose: both the client onboarding
 * (`app/adapt/adapt-flow.tsx`) and the server fallback (`src/adapt/fallback.ts`)
 * build this same line, so the fix lives in one place they can both import.
 */

/** A trailing run of sentence punctuation (with any trailing whitespace). */
const TRAILING_SENTENCE_PUNCTUATION = /[.,;:]+\s*$/;

/**
 * Join a proof result (`claim`) and its number (`metric`) into one line without
 * doubled punctuation. With no metric, the claim is returned trimmed and
 * untouched (its own terminal punctuation is legitimate).
 */
export function joinClaimMetric(claim: string, metric: string): string {
  const trimmedClaim = claim.trim();
  const trimmedMetric = metric.trim();
  if (trimmedMetric.length === 0) return trimmedClaim;
  const base = trimmedClaim.replace(TRAILING_SENTENCE_PUNCTUATION, "");
  if (base.length === 0) return trimmedMetric;
  return `${base}: ${trimmedMetric}`;
}
