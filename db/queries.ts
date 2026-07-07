import { desc, eq, sql } from "drizzle-orm";
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

/** Practices ranked by derived signal count (desc) for the push feed (R1). */
export async function feedPractices(db: Database): Promise<FeedRow[]> {
  const rows = await db
    .select({
      id: practices.id,
      name: practices.name,
      city: practices.city,
      state: practices.state,
      vertical: practices.vertical,
      signalCount: sql<number>`count(distinct ${signals.kind})`,
    })
    .from(practices)
    .leftJoin(signals, eq(signals.practiceId, practices.id))
    .groupBy(practices.id)
    .orderBy(desc(sql`count(distinct ${signals.kind})`));
  return rows.map((r) => ({ ...r, signalCount: Number(r.signalCount) }));
}
