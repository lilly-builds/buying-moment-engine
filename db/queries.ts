import { desc, eq, ne, sql } from "drizzle-orm";
import type { Database } from "./types";
import { practices, signals } from "./schema";

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

export interface FeedRow {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  vertical: string;
  signalCount: number;
}

/**
 * Practices ranked by derived signal count (desc) for the push feed (R1).
 *
 * TWO exclusions, for two different reasons:
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
 *    it with a vertical (`waterfall.ts`). Without the HAVING clause, that practice
 *    silently joins the hero feed with `signalCount = 0` — the demo's central claim
 *    ("handed a constant flow of practices hitting a buying moment") quietly broken
 *    by a lead that never hit one.
 *
 *    Do NOT confuse this with U8's zero-signal BRIEF variant. That variant is the
 *    honest detail page you reach by pasting a name. It is not a feed row.
 */
export async function feedPractices(db: Database): Promise<FeedRow[]> {
  const firedKinds = sql<number>`count(distinct ${signals.kind})`;
  const rows = await db
    .select({
      id: practices.id,
      name: practices.name,
      city: practices.city,
      state: practices.state,
      vertical: practices.vertical,
      signalCount: firedKinds,
    })
    .from(practices)
    .leftJoin(signals, eq(signals.practiceId, practices.id))
    .where(ne(practices.vertical, "unclassified"))
    .groupBy(practices.id)
    .having(sql`count(distinct ${signals.kind}) > 0`)
    .orderBy(desc(firedKinds));
  return rows.map((r) => ({ ...r, signalCount: Number(r.signalCount) }));
}
