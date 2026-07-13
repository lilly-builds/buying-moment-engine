import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  ne,
  notLike,
  or,
  sql,
} from "drizzle-orm";
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
  signalChecks,
  signals,
} from "./schema";
import { isFresh } from "@/src/engine/freshness";
import type { DetectorKind } from "@/src/ingest/validate";
import { PACK_VERTICALS, type PackVertical } from "@/src/packs";
import type { SignalRow } from "@/src/brief/inputs";

// ─────────────────────────────────────────────────────────────────────────────
// Seed/demo exclusion (D9 · the ROI-honesty rule)
//
// Every SEEDED practice carries a `demo:` geo-key prefix — the enterprise seed and
// the sandbox seed (`db/seed-demo.ts`, `db/seed-sandbox.ts`) both write `demo:${key}`,
// and the real discovery pipeline never does. So the prefix cleanly separates
// fabricated rows from the real cohort and NEVER matches a real practice.
//
// This is the SINGLE source of truth for that split. The live `/feed` and
// `/scoreboard` must reflect ONLY the real pipeline — fabricated seed ROI rendered as
// real would violate D9. Every real-facing aggregate that reads `practices` filters
// through `excludeDemoPractices` below; applying it in one place keeps the rule from
// being copy-pasted and forgotten in one query. The onboarding/styleguide walkthrough
// reads its OWN in-memory fixtures (`app/styleguide/demo-fixtures.ts`), not these
// queries, so it keeps showing its illustrative numbers untouched.
// ─────────────────────────────────────────────────────────────────────────────

/** The geo-key prefix every seeded/demo practice carries; the real pipeline never uses it. */
export const DEMO_GEO_KEY_PREFIX = "demo:";

/**
 * Pure predicate — true iff a geo key marks a seeded/demo practice. Unit-testable
 * without a DB, and the semantic twin of the `excludeDemoPractices` SQL fragment.
 */
export function isDemoGeoKey(geoKey: string | null | undefined): boolean {
  return typeof geoKey === "string" && geoKey.startsWith(DEMO_GEO_KEY_PREFIX);
}

/**
 * Shared WHERE fragment: KEEP real practices, DROP `demo:` ones. Written to also pass a
 * NULL `geo_key`: `practices.geo_key` is NOT NULL, so an inner-joined practice always
 * has one and this reduces to plain `NOT LIKE 'demo:%'`; but a LEFT JOIN miss (e.g. an
 * unattributed `cost_events` infra row with no practice) yields NULL, and that row MUST
 * still count. So the fragment reads "no practice, or a non-demo practice" and drops
 * safely into any query that reads `practices`, inner- or left-joined. Combine with an
 * existing predicate via `and(existing, excludeDemoPractices)`.
 */
export const excludeDemoPractices = or(
  isNull(practices.geoKey),
  notLike(practices.geoKey, `${DEMO_GEO_KEY_PREFIX}%`),
);

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
      and(
        inArray(roiEvents.eventType, [
          "lead_pushed",
          "meeting_booked",
          "deal_won",
          "time_saved_estimate",
        ]),
        // Real-facing: seeded funnel rows never count toward the live scoreboard (D9).
        excludeDemoPractices,
      ),
    );
}

/** Total metered spend (`cost_events.cost_usd`) grouped by the paying practice's vertical. */
export interface CostByVerticalRow {
  /** Null when the cost row has no practice (infra / unattributed) — counts only in "all". */
  vertical: string | null;
  costUsd: number;
}

export async function costByVertical(
  db: Database,
): Promise<CostByVerticalRow[]> {
  const rows = await db
    .select({
      vertical: practices.vertical,
      total: sql<string>`coalesce(sum(${costEvents.costUsd}), 0)`,
    })
    .from(costEvents)
    .leftJoin(practices, eq(practices.id, costEvents.practiceId))
    // Drop seeded practices' spend; KEEP unattributed infra spend (null practice).
    .where(excludeDemoPractices)
    .groupBy(practices.vertical);
  return rows.map((row) => ({
    vertical: row.vertical,
    costUsd: Number(row.total),
  }));
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
    .innerJoin(practices, eq(practices.id, feedback.practiceId))
    .where(excludeDemoPractices);
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
    .innerJoin(practices, eq(practices.id, crmLinks.practiceId))
    .where(excludeDemoPractices);
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

export async function practiceSignalKinds(
  db: Database,
): Promise<PracticeKindRow[]> {
  // Joined to `practices` solely to apply the demo exclusion: seeded practices' signal
  // kinds must not feed the scoreboard's "which signals convert" attribution (D9).
  return db
    .select({ practiceId: signals.practiceId, kind: signals.kind })
    .from(signals)
    .innerJoin(practices, eq(practices.id, signals.practiceId))
    .where(excludeDemoPractices);
}

/** Touch count per stored sequence (one brief's outreach), tagged with the vertical. */
export interface SequenceTouchRow {
  vertical: string;
  briefId: string;
  touches: number;
}

export async function sequenceTouchRows(
  db: Database,
): Promise<SequenceTouchRow[]> {
  const rows = await db
    .select({
      vertical: practices.vertical,
      briefId: sequences.briefId,
      touches: sql<number>`count(*)::int`,
    })
    .from(sequences)
    .innerJoin(briefs, eq(briefs.id, sequences.briefId))
    .innerJoin(practices, eq(practices.id, briefs.practiceId))
    .where(excludeDemoPractices)
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
    // `unclassified` is exclusion #1 (below); the demo filter is the integrity guard —
    // the live push feed shows ONLY the real pipeline, never seeded practices (D9).
    .where(and(ne(practices.vertical, "unclassified"), excludeDemoPractices))
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

export interface PracticeNeedingBrief {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  geoKey: string;
  /** The scrape seed for the conductor; null → Plan B fills it (U3). */
  websiteUrl: string | null;
  /** Distinct FRESH signal kinds — the ranking key, same rule as the feed (D8). */
  freshSignalCount: number;
}

/**
 * The seeding pull (U6): practices that are AT a buying moment but have no brief yet.
 *
 * Deliberately the SAME three exclusions as `feedPractices` — a brief we generate here
 * must be one that can actually appear in the feed:
 *   1. `unclassified` → no pack, no pitch (kept out in SQL).
 *   2. ZERO fresh signals → not at a buying moment (grouping drops it — it contributes
 *      no fresh kind, so it never enters `byPractice`).
 *   3. EXPIRED signals → aged out of the moment (`isFresh`, the single source of truth,
 *      NOT re-expressed as SQL).
 * Plus the one this query adds: a practice that ALREADY has a brief is excluded
 * (`LEFT JOIN briefs ... IS NULL`) — the query-level half of the conductor's idempotency
 * (the conductor's `getBrief` skip is the other half).
 *
 * Ordered hottest-first (distinct fresh kinds desc, then freshest detection desc) so a
 * small `limit` briefs the most-briefable, highest-signal practices first (cost discipline).
 * Grouped + limited in code because freshness is a code predicate; at demo scale (dozens
 * of practices) this is well within budget.
 *
 * `includeBriefed` (the seeding script's `--force`) drops the no-brief filter so already-
 * briefed practices are pulled too — a DELIBERATE regeneration path. The conductor still
 * needs `force: true` to actually rewrite them (otherwise it skips a found brief); the two
 * travel together in the CLI.
 */
export async function practicesNeedingBriefs(
  db: Database,
  opts: { now?: Date; limit?: number; includeBriefed?: boolean } = {},
): Promise<PracticeNeedingBrief[]> {
  const now = opts.now ?? new Date();
  const notUnclassified = ne(practices.vertical, "unclassified");
  const where = opts.includeBriefed
    ? notUnclassified
    : and(notUnclassified, isNull(briefs.id));
  const rows = await db
    .select({
      id: practices.id,
      name: practices.name,
      city: practices.city,
      state: practices.state,
      geoKey: practices.geoKey,
      websiteUrl: practices.websiteUrl,
      kind: signals.kind,
      detectedAt: signals.detectedAt,
      expiresAt: signals.expiresAt,
    })
    .from(practices)
    .innerJoin(signals, eq(signals.practiceId, practices.id))
    .leftJoin(briefs, eq(briefs.practiceId, practices.id))
    .where(where)
    .orderBy(asc(practices.id), asc(signals.kind), asc(signals.detectedAt));

  interface Acc extends PracticeNeedingBrief {
    freshest: Date;
    kinds: Set<string>;
  }
  const byPractice = new Map<string, Acc>();

  for (const row of rows) {
    if (row.detectedAt === null) continue;
    if (!isFresh(row.expiresAt, now)) continue;

    let entry = byPractice.get(row.id);
    if (!entry) {
      entry = {
        id: row.id,
        name: row.name,
        city: row.city,
        state: row.state,
        geoKey: row.geoKey,
        websiteUrl: row.websiteUrl,
        freshSignalCount: 0,
        freshest: row.detectedAt,
        kinds: new Set(),
      };
      byPractice.set(row.id, entry);
    }
    if (!entry.kinds.has(row.kind)) {
      entry.kinds.add(row.kind);
      entry.freshSignalCount += 1;
    }
    if (row.detectedAt > entry.freshest) entry.freshest = row.detectedAt;
  }

  const sorted = [...byPractice.values()].sort(
    (a, b) =>
      b.freshSignalCount - a.freshSignalCount ||
      b.freshest.getTime() - a.freshest.getTime(),
  );
  const limited =
    opts.limit !== undefined ? sorted.slice(0, opts.limit) : sorted;
  return limited.map((entry) => ({
    id: entry.id,
    name: entry.name,
    city: entry.city,
    state: entry.state,
    geoKey: entry.geoKey,
    websiteUrl: entry.websiteUrl,
    freshSignalCount: entry.freshSignalCount,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Proactive signal cross-check audit/cache (Thread 08)
// ─────────────────────────────────────────────────────────────────────────────

export const SIGNAL_CHECK_STATUSES = [
  "fired",
  "checked_no_signal",
  "errored",
  "skipped",
] as const;

export type SignalCheckStatus = (typeof SIGNAL_CHECK_STATUSES)[number];

export interface SignalCheckRow {
  id: string;
  practiceId: string;
  kind: DetectorKind;
  status: SignalCheckStatus;
  provider: string;
  checkedAt: Date;
  cooldownExpiresAt: Date;
  costUsd: number | null;
  matchedPracticeName: string | null;
  matchConfidence: number | null;
  evidenceId: string | null;
  reason: string | null;
}

function signalCheckRow(row: typeof signalChecks.$inferSelect): SignalCheckRow {
  return {
    id: row.id,
    practiceId: row.practiceId,
    kind: row.kind,
    status: row.status as SignalCheckStatus,
    provider: row.provider,
    checkedAt: row.checkedAt,
    cooldownExpiresAt: row.cooldownExpiresAt,
    costUsd: numericToNumber(row.costUsd),
    matchedPracticeName: row.matchedPracticeName,
    matchConfidence: numericToNumber(row.matchConfidence),
    evidenceId: row.evidenceId,
    reason: row.reason,
  };
}

export async function freshSignalCheck(
  db: Database,
  args: { practiceId: string; kind: DetectorKind; provider: string; now: Date },
): Promise<SignalCheckRow | null> {
  const [row] = await db
    .select()
    .from(signalChecks)
    .where(
      and(
        eq(signalChecks.practiceId, args.practiceId),
        eq(signalChecks.kind, args.kind),
        eq(signalChecks.provider, args.provider),
        gt(signalChecks.cooldownExpiresAt, args.now),
      ),
    )
    .limit(1);
  return row ? signalCheckRow(row) : null;
}

export interface UpsertSignalCheckArgs {
  practiceId: string;
  kind: DetectorKind;
  status: SignalCheckStatus;
  provider: string;
  checkedAt: Date;
  cooldownExpiresAt: Date;
  costUsd?: number | null;
  matchedPracticeName?: string | null;
  matchConfidence?: number | null;
  evidenceId?: string | null;
  reason?: string | null;
}

export async function upsertSignalCheck(
  db: Database,
  args: UpsertSignalCheckArgs,
): Promise<SignalCheckRow> {
  const mutable = {
    status: args.status,
    checkedAt: args.checkedAt,
    cooldownExpiresAt: args.cooldownExpiresAt,
    costUsd:
      args.costUsd === undefined || args.costUsd === null
        ? null
        : String(args.costUsd),
    matchedPracticeName: args.matchedPracticeName ?? null,
    matchConfidence:
      args.matchConfidence === undefined || args.matchConfidence === null
        ? null
        : String(args.matchConfidence),
    evidenceId: args.evidenceId ?? null,
    reason: args.reason ?? null,
    updatedAt: new Date(),
  };

  await db
    .insert(signalChecks)
    .values({
      practiceId: args.practiceId,
      kind: args.kind,
      provider: args.provider,
      createdAt: new Date(),
      ...mutable,
    })
    .onConflictDoUpdate({
      target: [
        signalChecks.practiceId,
        signalChecks.kind,
        signalChecks.provider,
      ],
      set: mutable,
    });

  const [row] = await db
    .select()
    .from(signalChecks)
    .where(
      and(
        eq(signalChecks.practiceId, args.practiceId),
        eq(signalChecks.kind, args.kind),
        eq(signalChecks.provider, args.provider),
      ),
    )
    .limit(1);
  return signalCheckRow(row);
}

const CROSS_CHECK_PROVIDERS: Array<{
  kind: DetectorKind;
  provider: string;
}> = [
  { kind: "staffing_spike", provider: "adzuna" },
  { kind: "growth_events", provider: "gdelt" },
  { kind: "phone_complaints", provider: "google-places" },
];

export async function practicesNeedingCrossChecks(
  db: Database,
  opts: { now?: Date; limit?: number } = {},
): Promise<FeedRow[]> {
  const now = opts.now ?? new Date();
  const limit = opts.limit;
  if (limit !== undefined && limit <= 0) return [];

  const feed = await feedPractices(db, now);
  const needingChecks: FeedRow[] = [];

  for (const practice of feed) {
    const freshKinds = new Set(practice.signals.map((signal) => signal.kind));
    let needsCheck = false;

    for (const target of CROSS_CHECK_PROVIDERS) {
      if (freshKinds.has(target.kind)) continue;
      const freshCheck = await freshSignalCheck(db, {
        practiceId: practice.id,
        kind: target.kind,
        provider: target.provider,
        now,
      });
      if (!freshCheck) {
        needsCheck = true;
        break;
      }
    }

    if (!needsCheck) continue;
    needingChecks.push(practice);
    if (limit !== undefined && needingChecks.length >= limit) break;
  }

  return needingChecks;
}
