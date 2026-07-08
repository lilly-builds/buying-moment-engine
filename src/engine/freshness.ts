import type { DetectorKind } from "@/src/ingest/validate";

/**
 * Freshness (R3/R7 + KTD) — the framework owns signal decay so a stored brief
 * never claims a stale buying moment. PURE: no I/O, no clock read except the
 * `now` a caller passes in, so every helper unit-tests with no DB.
 *
 * Per-kind windows are chosen by how long the underlying business moment stays
 * a real, actionable buying trigger:
 *  - staffing_spike (30d): a job posting / hiring burst is a NOW signal — the
 *    role fills or is pulled within weeks, so it goes stale fastest.
 *  - growth_events (60d): a funding round / new-location announcement stays a
 *    relevant trigger for roughly a sales quarter's first half.
 *  - phone_complaints (90d): an operational pain pattern persists across a
 *    quarter and is slow to resolve, so it stays actionable longer.
 *  - regulation (180d): regulatory shifts move on multi-month timelines and
 *    stay the longest-lived trigger of the four.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const FRESHNESS_WINDOW_DAYS: Record<DetectorKind, number> = {
  staffing_spike: 30,
  growth_events: 60,
  phone_complaints: 90,
  regulation: 180,
};

export function windowDaysFor(kind: DetectorKind): number {
  return FRESHNESS_WINDOW_DAYS[kind];
}

/** The instant a signal of `kind` detected at `detectedAt` stops being fresh. */
export function computeExpiresAt(kind: DetectorKind, detectedAt: Date): Date {
  return new Date(detectedAt.getTime() + windowDaysFor(kind) * DAY_MS);
}

/**
 * Is the signal still inside its window at `now`? A null/absent expiry means the
 * window is unknown/unbounded — treated as fresh so we never silently drop a
 * signal we simply couldn't date.
 */
export function isFresh(
  expiresAt: Date | null | undefined,
  now: Date,
): boolean {
  if (!expiresAt) return true;
  return now.getTime() < expiresAt.getTime();
}

/**
 * Linear freshness weight in [0,1] for rank decay: 1.0 at detection, sliding to
 * 0.0 at (and past) expiry. Null window => 1.0 (no decay). Pure — feeds the
 * decayed rank score in `scoring.ts`.
 */
export function freshnessWeight(
  detectedAt: Date,
  expiresAt: Date | null | undefined,
  now: Date,
): number {
  if (!expiresAt) return 1;
  const start = detectedAt.getTime();
  const end = expiresAt.getTime();
  const t = now.getTime();
  if (end <= start) return t < end ? 1 : 0; // degenerate/zero-length window
  if (t <= start) return 1;
  if (t >= end) return 0;
  return (end - t) / (end - start);
}
