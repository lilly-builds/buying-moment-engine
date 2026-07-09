import { asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Database } from "./types";
import {
  briefs,
  costEvents,
  crmLinks,
  evidence,
  feedback,
  practices,
  roiEvents,
  sequences,
  signals,
} from "./schema";
import { isFresh } from "@/src/engine/freshness";
import type { DetectorKind } from "@/src/ingest/validate";
import { PACK_VERTICALS, type PackVertical } from "@/src/packs";
import type { SignalRow } from "@/src/brief/inputs";

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

/** postgres `numeric` comes back as a string; coerce to number, keep null. */
function numericToNumber(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Every signal for one practice, joined to the evidence that proves it — exactly the
 * `SignalRow[]` `renderBrief` needs to compute the live buying-moment view (U9).
 *
 * The signal read is the SAME join, order, and numeric coercion as
 * `src/brief/inputs.ts#buildBriefInput`, but returns ONLY signals: the deep-brief route
 * renders a STORED brief and needs the live signal set, not the whole generation input
 * (facts, contact, pack) or its `unclassified-vertical` failure path. Deliberately NOT
 * filtered by freshness — `liveSignalView` runs `freshSignals` itself, and `isBriefStale`
 * needs the full set to notice a signal that has expired out of the window.
 */
export async function practiceSignalRows(
  db: Database,
  practiceId: string,
): Promise<SignalRow[]> {
  const rows = await db
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

  return rows.map((row) => ({
    kind: row.kind,
    signalSource: row.signalSource,
    detectedAt: row.detectedAt,
    expiresAt: row.expiresAt,
    confidence: numericToNumber(row.signalConfidence),
    evidence: {
      id: row.evidenceId,
      sourceUrl: row.sourceUrl,
      snippet: row.snippet,
      detectedAt: row.evidenceDetectedAt,
      confidence: numericToNumber(row.evidenceConfidence),
    },
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// ROI scoreboard aggregation (U12 / D10)
//
// The scoreboard is COMPUTED, never stored: raw `roi_events` + `cost_events` (+ the
// AE `feedback` and `crm_links` the tool already writes), sliced per vertical. These
// functions return the raw rows; `app/scoreboard/data.ts#buildScoreboardData` shapes
// them into the view's `ScoreboardData` and applies the honesty tags (D10).
//
// Per-vertical slicing joins `roi_events → practices.vertical` rather than reading
// `roi_events.vertical`: the milestone writer (`src/crm/sync.ts#recordStageForPractice`)
// leaves that column NULL on `meeting_booked` / `deal_won`, so the practice's own
// vertical is the only reliable slice. The funnel milestones are exactly-once per
// practice (R8/R12), so a count is "how many practices reached this step".
// ─────────────────────────────────────────────────────────────────────────────

/** The tool's funnel + activity events, tagged with the practice's vertical. */
export interface RoiEventRow {
  practiceId: string;
  /** `practices.vertical` — may be `unclassified`; the assembler buckets on the slug. */
  vertical: string;
  eventType: string;
  payload: unknown;
}

/**
 * Every funnel / activity event, joined to its practice's vertical. INNER join: an event
 * with no practice (`practice_id` is nullable on `roi_events`) cannot be sliced by
 * vertical and does not belong to the funnel, so it is dropped here.
 */
export async function roiEventRows(db: Database): Promise<RoiEventRow[]> {
  return db
    .select({
      practiceId: practices.id,
      vertical: practices.vertical,
      eventType: roiEvents.eventType,
      payload: roiEvents.payload,
    })
    .from(roiEvents)
    .innerJoin(practices, eq(practices.id, roiEvents.practiceId))
    .where(
      inArray(roiEvents.eventType, [
        "lead_pushed",
        "meeting_booked",
        "deal_won",
        "time_saved_estimate",
      ]),
    );
}

/** Total metered spend (`cost_events.cost_usd`) grouped by the paying practice's vertical. */
export interface CostByVerticalRow {
  /** Null when the cost row has no practice (infra / unattributed) — counts only in "all". */
  vertical: string | null;
  costUsd: number;
}

export async function costByVertical(db: Database): Promise<CostByVerticalRow[]> {
  const rows = await db
    .select({
      vertical: practices.vertical,
      total: sql<string>`coalesce(sum(${costEvents.costUsd}), 0)`,
    })
    .from(costEvents)
    .leftJoin(practices, eq(practices.id, costEvents.practiceId))
    .groupBy(practices.vertical);
  return rows.map((row) => ({ vertical: row.vertical, costUsd: Number(row.total) }));
}

/** One AE lead-quality verdict, tagged with the practice's vertical. */
export interface FeedbackRow {
  vertical: string;
  thumb: "up" | "down";
  reason: string | null;
}

export async function feedbackRows(db: Database): Promise<FeedbackRow[]> {
  return db
    .select({
      vertical: practices.vertical,
      thumb: feedback.thumb,
      reason: feedback.reason,
    })
    .from(feedback)
    .innerJoin(practices, eq(practices.id, feedback.practiceId));
}

/** A deal's cycle time (`crm_links.cycle_time_days`), tagged with the practice's vertical. */
export interface CycleRow {
  vertical: string;
  cycleTimeDays: number | null;
}

export async function cycleRows(db: Database): Promise<CycleRow[]> {
  const rows = await db
    .select({
      vertical: practices.vertical,
      cycle: crmLinks.cycleTimeDays,
    })
    .from(crmLinks)
    .innerJoin(practices, eq(practices.id, crmLinks.practiceId));
  return rows.map((row) => ({
    vertical: row.vertical,
    cycleTimeDays: numericToNumber(row.cycle),
  }));
}

/** Which signal KINDS a practice carried — the attribution for "which signals convert". */
export interface PracticeKindRow {
  practiceId: string;
  kind: DetectorKind;
}

export async function practiceSignalKinds(db: Database): Promise<PracticeKindRow[]> {
  return db.select({ practiceId: signals.practiceId, kind: signals.kind }).from(signals);
}

/** Touch count per stored sequence (one brief's outreach), tagged with the vertical. */
export interface SequenceTouchRow {
  vertical: string;
  briefId: string;
  touches: number;
}

export async function sequenceTouchRows(db: Database): Promise<SequenceTouchRow[]> {
  const rows = await db
    .select({
      vertical: practices.vertical,
      briefId: sequences.briefId,
      touches: sql<number>`count(*)::int`,
    })
    .from(sequences)
    .innerJoin(briefs, eq(briefs.id, sequences.briefId))
    .innerJoin(practices, eq(practices.id, briefs.practiceId))
    .groupBy(practices.vertical, sequences.briefId);
  return rows.map((row) => ({
    vertical: row.vertical,
    briefId: row.briefId,
    touches: Number(row.touches),
  }));
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
