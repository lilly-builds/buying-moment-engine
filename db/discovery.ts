import { eq } from "drizzle-orm";
import type { Database } from "./types";
import { discoveryCandidates } from "./schema";
import { isFresh } from "@/src/engine/freshness";

/**
 * Discovery-candidate persistence (U2). Idempotent upsert keyed on `place_id`, and
 * the re-pull cache check. Mirrors the ingest rail's idempotency discipline
 * (`db/ingest.ts`): a re-run refreshes the SAME row rather than duplicating it, so
 * the archive lane never grows a second row for a place we have seen before.
 *
 * Google ToS (R5): the write surface below has NO field for review text. Only
 * `place_id`, public listing facts, and OUR derived verdict/kind can be persisted —
 * the rule is structural here, not a comment asking nicely.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Our closed verdict vocabulary — the derived judgement stored on a candidate.
 * Deliberately NOT the per-tenant review "category" (which is open text); this is
 * the pipeline's own disposition of the place.
 *  - not-targeted     — dropped by the rating funnel before the expensive step.
 *  - checked-no-signal — Details pulled, LLM ran, no review qualified.
 *  - qualified        — a review qualified; a signal was emitted onto the feed.
 */
export const DISCOVERY_VERDICTS = [
  "not-targeted",
  "checked-no-signal",
  "qualified",
] as const;

export type DiscoveryVerdict = (typeof DISCOVERY_VERDICTS)[number];

export interface DiscoveryCandidateRow {
  placeId: string;
  tenantId: string;
  name: string;
  geoKey: string;
  vertical?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  /** When we last pulled Details+reviews. Omit/null when the expensive step was skipped. */
  lastPulledAt?: Date | null;
  lastVerdict: DiscoveryVerdict;
  /** The signal kind emitted when qualified, else null. Never a review's text. */
  qualifiedKind?: string | null;
  detectedAt: Date;
}

/**
 * Idempotent upsert on `place_id`. On conflict it REFRESHES the mutable columns
 * (verdict, rating, last_pulled_at, …) so a later rotation's re-verdict lands on
 * the same row — including the resurface path (`checked-no-signal -> qualified`)
 * without ever losing the row. `created_at`/`detected_at` are first-seen columns
 * and are not overwritten on conflict.
 */
export async function upsertDiscoveryCandidate(
  db: Database,
  row: DiscoveryCandidateRow,
) {
  // postgres `numeric` is written as a string; keep null as null.
  const rating =
    row.rating === null || row.rating === undefined ? null : String(row.rating);

  const mutable = {
    tenantId: row.tenantId,
    name: row.name,
    geoKey: row.geoKey,
    vertical: row.vertical ?? null,
    rating,
    reviewCount: row.reviewCount ?? null,
    lastPulledAt: row.lastPulledAt ?? null,
    lastVerdict: row.lastVerdict,
    qualifiedKind: row.qualifiedKind ?? null,
  };

  await db
    .insert(discoveryCandidates)
    .values({
      placeId: row.placeId,
      detectedAt: row.detectedAt,
      ...mutable,
    })
    .onConflictDoUpdate({
      target: discoveryCandidates.placeId,
      // `detected_at`/`created_at` are FIRST-SEEN provenance — not refreshed. bump
      // `updated_at` explicitly: a conflict-update spec does not fire `$onUpdate`.
      set: { ...mutable, updatedAt: new Date() },
    });

  const [saved] = await db
    .select()
    .from(discoveryCandidates)
    .where(eq(discoveryCandidates.placeId, row.placeId))
    .limit(1);
  return saved;
}

/**
 * The re-pull cache gate (R7/K6). True when this place was pulled recently enough
 * to skip the expensive Details+LLM step. An ABSENT place, or one that exists but
 * was never pulled (`last_pulled_at IS NULL` — a funnel-dropped archive row), is
 * NOT fresh: both mean "we hold no recent verdict, so pull it". Reuses the pure
 * `isFresh` so freshness is decided by the same helper the feed and scoring use —
 * here against `last_pulled_at + windowDays`.
 */
export async function isPlaceFresh(
  db: Database,
  placeId: string,
  now: Date,
  windowDays: number,
): Promise<boolean> {
  const [row] = await db
    .select({ lastPulledAt: discoveryCandidates.lastPulledAt })
    .from(discoveryCandidates)
    .where(eq(discoveryCandidates.placeId, placeId))
    .limit(1);

  if (!row || row.lastPulledAt === null) return false;
  const expiresAt = new Date(row.lastPulledAt.getTime() + windowDays * DAY_MS);
  return isFresh(expiresAt, now);
}
