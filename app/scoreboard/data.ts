import type { Database } from "@/db/types";
import type { StatHonesty } from "@/design/components";
import { PACK_VERTICALS, type PackVertical } from "@/src/packs";
import type { DetectorKind } from "@/src/ingest/validate";
import {
  toSignalKind,
  toVerticalSlug,
  VERTICAL_FILTERS,
  type FeedFilterValue,
  type VerticalSlug,
} from "@/src/ui/signal-display";
import {
  costByVertical,
  cycleRows,
  feedbackRows,
  practiceSignalKinds,
  roiEventRows,
  sequenceTouchRows,
  type CostByVerticalRow,
  type CycleRow,
  type FeedbackRow,
  type PracticeKindRow,
  type RoiEventRow,
  type SequenceTouchRow,
} from "@/db/queries";
import type {
  BigTest,
  FeedbackSummary,
  ScopeData,
  ScoreMetric,
  ScoreboardData,
  SignalConversion,
  VerticalRow,
} from "../scoreboard-view";

/**
 * The ROI scoreboard's data layer (U12 / D10).
 *
 * `buildScoreboardData` is PURE — it takes the raw `roi_events` / `cost_events` /
 * `feedback` / `crm_links` rows and shapes them into the view's `ScoreboardData`, applying
 * the honesty tags. `loadScoreboardData` is the DB-bound wrapper the route calls.
 *
 * The honesty split follows D10 and the approved design's own stance: the tool's activity
 * counts (meetings, cost/meeting, messages, hours) are **measured** — read straight off the
 * events the tool logged; the pipeline outcomes (deals, CAC) are **modeled** — projected
 * until enough real deals flow. A denominator with no data degrades to "—", never a
 * fabricated or divide-by-zero number.
 */

// ── Raw inputs ───────────────────────────────────────────────────────────────

export interface ScoreboardInputs {
  events: RoiEventRow[];
  cost: CostByVerticalRow[];
  feedback: FeedbackRow[];
  cycles: CycleRow[];
  signalKinds: PracticeKindRow[];
  sequences: SequenceTouchRow[];
}

export async function loadScoreboardInputs(db: Database): Promise<ScoreboardInputs> {
  const [events, cost, feedback, cycles, signalKinds, sequences] = await Promise.all([
    roiEventRows(db),
    costByVertical(db),
    feedbackRows(db),
    cycleRows(db),
    practiceSignalKinds(db),
    sequenceTouchRows(db),
  ]);
  return { events, cost, feedback, cycles, signalKinds, sequences };
}

export async function loadScoreboardData(db: Database): Promise<ScoreboardData> {
  return buildScoreboardData(await loadScoreboardInputs(db));
}

// ── Shaping helpers ──────────────────────────────────────────────────────────

const NO_DATA = "—";

/** The signal kinds the scoreboard reports conversion for (the three with a pill/gradient). */
const CONVERSION_KINDS: ReadonlyArray<{ kind: DetectorKind; label: string }> = [
  { kind: "staffing_spike", label: "Staffing spike" },
  { kind: "phone_complaints", label: "Phone complaints" },
  { kind: "growth_events", label: "Growth event" },
];

/** `feedback_reason` enum → the AE-facing label the design shows. */
const FEEDBACK_REASONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "too_small", label: "Too small" },
  { key: "wrong_specialty", label: "Wrong specialty" },
  { key: "already_customer", label: "Already a customer" },
  { key: "bad_timing", label: "Bad timing" },
];

const VERTICAL_LABEL: Record<VerticalSlug, string> = Object.fromEntries(
  VERTICAL_FILTERS.filter((f) => f.value !== "all").map((f) => [f.value, f.label]),
) as Record<VerticalSlug, string>;

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** Kebab slug for a DB vertical, or null for `unclassified` (which never joins a scope). */
function scopeSlug(vertical: string): VerticalSlug | null {
  return (PACK_VERTICALS as readonly string[]).includes(vertical)
    ? toVerticalSlug(vertical as PackVertical)
    : null;
}

function inScope(vertical: string, scope: FeedFilterValue): boolean {
  return scope === "all" ? true : scopeSlug(vertical) === scope;
}

function metric(
  label: string,
  value: string,
  honesty: StatHonesty,
  caption: string,
): ScoreMetric {
  // Deltas are intentionally omitted, not faked: period-over-period comparison needs a
  // prior-window baseline the event log does not yet carry. A missing delta renders
  // clean; a fabricated "+6 vs last qtr" would violate D10.
  return { label, value, honesty, caption };
}

// ── Per-practice funnel folding ──────────────────────────────────────────────

type Cohort = "buying_moment" | "cold";

interface PracticeFunnel {
  practiceId: string;
  vertical: string;
  lead: boolean;
  meeting: boolean;
  deal: boolean;
  cohort: Cohort;
  hours: number;
}

function asRecord(payload: unknown): Record<string, unknown> {
  return payload !== null && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : {};
}

function cohortOf(payload: unknown): Cohort | null {
  return asRecord(payload).cohort === "cold" ? "cold" : null;
}

function hoursOf(payload: unknown): number {
  const h = asRecord(payload).hours;
  return typeof h === "number" && Number.isFinite(h) ? h : 0;
}

function foldFunnel(events: RoiEventRow[]): Map<string, PracticeFunnel> {
  const funnel = new Map<string, PracticeFunnel>();
  for (const e of events) {
    let f = funnel.get(e.practiceId);
    if (!f) {
      f = {
        practiceId: e.practiceId,
        vertical: e.vertical,
        lead: false,
        meeting: false,
        deal: false,
        cohort: "buying_moment",
        hours: 0,
      };
      funnel.set(e.practiceId, f);
    }
    switch (e.eventType) {
      case "lead_pushed": {
        f.lead = true;
        const c = cohortOf(e.payload);
        if (c) f.cohort = c;
        break;
      }
      case "meeting_booked":
        f.meeting = true;
        break;
      case "deal_won":
        f.deal = true;
        break;
      case "time_saved_estimate":
        f.hours += hoursOf(e.payload);
        break;
    }
  }
  return funnel;
}

// ── Assembly ─────────────────────────────────────────────────────────────────

export function buildScoreboardData(inputs: ScoreboardInputs): ScoreboardData {
  const funnel = foldFunnel(inputs.events);
  const practices = [...funnel.values()];

  const kindsByPractice = new Map<string, Set<DetectorKind>>();
  for (const row of inputs.signalKinds) {
    const set = kindsByPractice.get(row.practiceId) ?? new Set<DetectorKind>();
    set.add(row.kind);
    kindsByPractice.set(row.practiceId, set);
  }

  const costForScope = (scope: FeedFilterValue): number =>
    inputs.cost
      .filter((c) => (scope === "all" ? true : c.vertical !== null && scopeSlug(c.vertical) === scope))
      .reduce((sum, c) => sum + c.costUsd, 0);

  const avgCycleForScope = (scope: FeedFilterValue): number | null => {
    const days = inputs.cycles
      .filter((c) => inScope(c.vertical, scope) && c.cycleTimeDays !== null)
      .map((c) => c.cycleTimeDays as number);
    return days.length > 0 ? days.reduce((a, b) => a + b, 0) / days.length : null;
  };

  const avgTouchesForScope = (scope: FeedFilterValue): number | null => {
    const t = inputs.sequences.filter((s) => inScope(s.vertical, scope)).map((s) => s.touches);
    return t.length > 0 ? t.reduce((a, b) => a + b, 0) / t.length : null;
  };

  const feedbackForScope = (scope: FeedFilterValue): FeedbackSummary => {
    const rows = inputs.feedback.filter((r) => inScope(r.vertical, scope));
    const up = rows.filter((r) => r.thumb === "up").length;
    const total = rows.length;
    return {
      thumbsUpRate: total > 0 ? up / total : 0,
      total,
      reasons: FEEDBACK_REASONS.map((r) => ({
        label: r.label,
        count: rows.filter((row) => row.reason === r.key).length,
      })),
    };
  };

  const signalConversionForScope = (
    scoped: PracticeFunnel[],
  ): SignalConversion[] =>
    CONVERSION_KINDS.map(({ kind, label }) => {
      const withKind = scoped.filter((f) => kindsByPractice.get(f.practiceId)?.has(kind));
      const leads = withKind.filter((f) => f.lead).length;
      const meetings = withKind.filter((f) => f.lead && f.meeting).length;
      return {
        // `toSignalKind` is non-null for all three CONVERSION_KINDS by construction.
        kind: toSignalKind(kind) ?? "staffing-spike",
        label,
        rate: leads > 0 ? meetings / leads : 0,
        detail: `${meetings} meetings / ${leads} leads`,
      };
    });

  const buildScope = (scope: FeedFilterValue): ScopeData => {
    const scoped = practices.filter((f) => inScope(f.vertical, scope));
    const leads = scoped.filter((f) => f.lead).length;
    const meetings = scoped.filter((f) => f.meeting).length;
    const deals = scoped.filter((f) => f.deal).length;
    const hours = scoped.reduce((sum, f) => sum + f.hours, 0);
    const cost = costForScope(scope);
    const touches = avgTouchesForScope(scope);

    return {
      endGoals: [
        metric(
          "Deals won",
          String(deals),
          "modeled",
          "Are we closing more? The revenue outcome every sign below points at.",
        ),
        metric(
          "Cost to win a customer (CAC)",
          deals > 0 ? money(cost / deals) : NO_DATA,
          "modeled",
          "Does each new customer cost less? Real tool spend ÷ new customers.",
        ),
      ],
      leading: [
        metric(
          "Meetings the tool booked",
          String(meetings),
          "measured",
          "Prove the tool's pulling weight → expand it.",
        ),
        metric(
          "Cost per meeting",
          meetings > 0 ? money(cost / meetings) : NO_DATA,
          "measured",
          "Put budget where meetings are cheapest.",
        ),
        metric(
          "Messages to land a meeting",
          touches !== null ? touches.toFixed(1) : NO_DATA,
          "measured",
          "Fix the sequences that aren't landing.",
        ),
        metric(
          "Hours saved",
          String(Math.round(hours)),
          "measured",
          "Free reps to sell more → roll it out wider.",
        ),
      ],
      signalConversion: signalConversionForScope(scoped),
      overallConversion: leads > 0 ? meetings / leads : 0,
      feedback: feedbackForScope(scope),
    };
  };

  const scopeKeys: FeedFilterValue[] = ["all", ...PACK_VERTICALS.map((v) => toVerticalSlug(v))];
  const scopes: Record<string, ScopeData> = {};
  for (const key of scopeKeys) scopes[key] = buildScope(key);

  const verticals: VerticalRow[] = PACK_VERTICALS.map((v) => {
    const slug = toVerticalSlug(v);
    const scoped = practices.filter((f) => scopeSlug(f.vertical) === slug);
    const leads = scoped.filter((f) => f.lead).length;
    const meetings = scoped.filter((f) => f.meeting).length;
    const deals = scoped.filter((f) => f.deal).length;
    const cost = costForScope(slug);
    const cycle = avgCycleForScope(slug);
    return {
      slug,
      label: VERTICAL_LABEL[slug],
      winRate: leads > 0 ? deals / leads : 0,
      costPerMeeting: meetings > 0 ? money(cost / meetings) : NO_DATA,
      cycleDays: cycle !== null ? `${Math.round(cycle)}d` : NO_DATA,
    };
  });

  const cohortTally = (cohort: Cohort): { meetings: number; deals: number } => {
    const rows = practices.filter((f) => f.cohort === cohort);
    return {
      meetings: rows.filter((f) => f.meeting).length,
      deals: rows.filter((f) => f.deal).length,
    };
  };

  const bigTest: BigTest = {
    buyingMoment: cohortTally("buying_moment"),
    cold: cohortTally("cold"),
  };

  return { scopes, verticals, bigTest };
}

/** An honest all-zero scoreboard for a keyless clone or an unreachable DB. */
export function emptyScoreboardData(): ScoreboardData {
  return buildScoreboardData({
    events: [],
    cost: [],
    feedback: [],
    cycles: [],
    signalKinds: [],
    sequences: [],
  });
}
