import { asc, eq, ne, sql } from "drizzle-orm";
import type { Database } from "./types";
import { practices, signals } from "./schema";
import { isFresh } from "@/src/engine/freshness";
import type { DetectorKind } from "@/src/ingest/validate";
import { PACK_VERTICALS, type PackVertical } from "@/src/packs";

/**
 * Derived read helpers. Signal count is DERIVED — distinct fired signal kinds,
 * computed at query time, never stored as a denormalized column (R17).
 */

export async function signalCount(
  db: Database,
  practiceId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${signals.kind})` })
    .from(signals)
    .where(eq(signals.practiceId, practiceId));
  return Number(row?.n ?? 0);
}

/** One fired signal, as the feed row needs it: which kind, how old, when it dies. */
export interface FeedSignal {
  kind: DetectorKind;
  detectedAt: Date;
  expiresAt: Date | null;
}

export interface FeedRow {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  /** Narrowed: `unclassified` cannot reach the feed, so it cannot reach this type. */
  vertical: PackVertical;
  /** Distinct FRESH signal kinds. The number the feed ranks on (R1/D8). */
  signalCount: number;
  /** One entry per distinct fresh kind, freshest first. Drives the pills. */
  signals: FeedSignal[];
  /** The most recently detected fresh signal. Never undefined — see the guards. */
  freshest: FeedSignal;
}

function isPackVertical(value: string): value is PackVertical {
  return (PACK_VERTICALS as readonly string[]).includes(value);
}

/**
 * Practices at a buying moment, ranked for the push feed (R1).
 *
 * THREE exclusions, for three different reasons:
 *
 * 1. `unclassified` practices (R6, U5) — a practice whose specialty the classifier
 *    could not resolve has no vertical pack, so it has no pain line, no opener, and
 *    no proof point. Showing it would mean either an empty card or a guessed
 *    vertical; withholding it is the honest behaviour. `isFeedEligible` in
 *    `src/engine/verticals.ts` is the same rule in pure code.
 *
 * 2. ZERO-SIGNAL practices (R1/D5) — the push feed is "practices at a buying moment
 *    right now." A practice with no fired signal is not at one. This is not
 *    hypothetical: U8's pull mode enriches a pasted practice, and the waterfall tags
 *    it with a vertical (`waterfall.ts`). Without this guard, that practice
 *    silently joins the hero feed with `signalCount = 0` — the demo's central claim
 *    ("handed a constant flow of practices hitting a buying moment") quietly broken
 *    by a lead that never hit one.
 *
 *    Do NOT confuse this with U8's zero-signal BRIEF variant. That variant is the
 *    honest detail page you reach by pasting a name. It is not a feed row.
 *
 * 3. EXPIRED signals (U8) — a signal past its freshness window is not a buying moment
 *    either. This query used to count every signal ever detected, while the brief page
 *    counts only fresh ones (`liveSignalView` -> `freshSignals`). A feed row could
 *    therefore advertise "3 signals firing" and, one click later, its own brief would
 *    show one — the exact failure the KTD forbids, arrived at from the feed side
 *    instead of the stored-brief side. A practice whose every signal has aged out now
 *    leaves the feed entirely, because it counts zero fresh kinds.
 *
 * Freshness is decided by `isFresh` — the SAME pure function the brief and the scoring
 * engine call. It is deliberately NOT re-expressed as SQL: a second copy of "what
 * counts as fresh" is a second thing to keep in step, and the per-kind windows already
 * live in `src/engine/freshness.ts`.
 *
 * RANKING (D8, and U8's "freshness tiebreak"): distinct fresh kinds descending, then
 * most recent detection descending. A 3-signal practice outranks a 1-signal one; at
 * equal counts the fresher lead wins.
 *
 * `now` defaults to the wall clock so existing callers keep working; pass it
 * explicitly to make a test deterministic.
 */
export async function feedPractices(
  db: Database,
  now: Date = new Date(),
): Promise<FeedRow[]> {
  const rows = await db
    .select({
      id: practices.id,
      name: practices.name,
      city: practices.city,
      state: practices.state,
      vertical: practices.vertical,
      kind: signals.kind,
      detectedAt: signals.detectedAt,
      expiresAt: signals.expiresAt,
    })
    .from(practices)
    // INNER, not LEFT: a practice with no signal row cannot be at a buying moment,
    // so it should never enter the grouping in the first place (exclusion 2).
    .innerJoin(signals, eq(signals.practiceId, practices.id))
    .where(ne(practices.vertical, "unclassified"))
    // Stable order in, stable order out — two runs over the same rows rank alike.
    .orderBy(asc(practices.id), asc(signals.kind), asc(signals.detectedAt));

  // Grouped in code rather than in SQL, so `isFresh` stays the single source of truth
  // for the freshness rule.
  const byPractice = new Map<string, FeedRow>();

  for (const row of rows) {
    if (!isPackVertical(row.vertical)) continue; // belt and braces; SQL excluded it
    // `detected_at` is nullable for rows written before U5 tightened the column. An
    // undated signal cannot prove a buying MOMENT, and it has no age to draw.
    if (row.detectedAt === null) continue;
    if (!isFresh(row.expiresAt, now)) continue;

    const signal: FeedSignal = {
      kind: row.kind,
      detectedAt: row.detectedAt,
      expiresAt: row.expiresAt,
    };

    const existing = byPractice.get(row.id);
    if (!existing) {
      byPractice.set(row.id, {
        id: row.id,
        name: row.name,
        city: row.city,
        state: row.state,
        vertical: row.vertical,
        signalCount: 1,
        signals: [signal],
        freshest: signal,
      });
      continue;
    }

    // Distinct KINDS, not evidence rows. Two staffing-spike postings are one signal:
    // a practice with three job ads has not hit three buying moments, and ranking it
    // above a practice with three DIFFERENT signals would invert the whole thesis.
    const sameKind = existing.signals.find((s) => s.kind === signal.kind);
    if (sameKind) {
      if (signal.detectedAt > sameKind.detectedAt) {
        sameKind.detectedAt = signal.detectedAt;
        sameKind.expiresAt = signal.expiresAt;
      }
    } else {
      existing.signals.push(signal);
      existing.signalCount += 1;
    }

    if (signal.detectedAt > existing.freshest.detectedAt) {
      existing.freshest = signal;
    }
  }

  const feed = [...byPractice.values()];
  for (const row of feed) {
    row.signals.sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());
  }

  return feed.sort(
    (a, b) =>
      b.signalCount - a.signalCount ||
      b.freshest.detectedAt.getTime() - a.freshest.detectedAt.getTime(),
  );
}
