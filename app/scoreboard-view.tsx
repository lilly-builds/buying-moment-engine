"use client";

import { useState } from "react";
import {
  Badge,
  Card,
  Meter,
  PageContainer,
  SectionHeader,
  SegmentedControl,
  StatRing,
  StatTile,
  TopNav,
  type SignalKind,
  type StatDelta,
  type StatHonesty,
} from "@/design/components";
import { gradients, signalGradients } from "@/design/tokens";
import { VERTICAL_FILTERS, type FeedFilterValue } from "@/src/ui/signal-display";

/**
 * The ROI Scoreboard (U12) — the tool's own impact, scoped to THIS build, not a
 * generic company dashboard (R3). Its discipline: a number is here only because it
 * drives a move — so every section names the loop it powers (Smarter tool / Smarter
 * GTM) and the decision it changes. The two lagging outcomes — deals and CAC — sit at
 * the top; every leading sign below is trying to move one of them.
 *
 * D10's honesty tag rides every number: MEASURED (real, from the tool) or MODELED
 * (projected from public benchmarks). Everything is viewable aggregate + per-vertical.
 *
 * Surface matches the feed and the brief (Lilly, 2026-07-08): the health-blue hero
 * paints the whole page, working panels are white ELEVATED cards floating on it.
 *
 * A number is a form, not a chart (dataviz): headline figures are StatTiles, ratios
 * are Meters, and the one signal→meeting headline is a StatRing. Colour still only
 * encodes — the signal meters carry the signal gradients an AE already knows; every
 * magnitude comparison stays ink.
 */

// ─── The data contract (computed from roi_events / cost_events in production) ──

export interface ScoreMetric {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: StatDelta;
  honesty: StatHonesty;
  /** The move this number drives (R3). */
  caption?: string;
}

export interface SignalConversion {
  kind: SignalKind;
  label: string;
  /** 0..1 — share of this signal's leads that became a meeting. */
  rate: number;
  detail: string;
}

export interface VerticalRow {
  slug: string;
  label: string;
  winRate: number;
  costPerMeeting: string;
  cycleDays: string;
}

export interface FeedbackSummary {
  thumbsUpRate: number;
  total: number;
  reasons: { label: string; count: number }[];
}

export interface BigTest {
  buyingMoment: { meetings: number; deals: number };
  cold: { meetings: number; deals: number };
}

export interface ScopeData {
  /** [deals won, cost to acquire a customer] — the two lagging outcomes. */
  endGoals: [ScoreMetric, ScoreMetric];
  leading: ScoreMetric[];
  signalConversion: SignalConversion[];
  /** 0..1 headline: overall signal→meeting conversion. */
  overallConversion: number;
  feedback: FeedbackSummary;
}

export interface ScoreboardData {
  /** Keyed by "all" + each vertical slug. */
  scopes: Record<string, ScopeData>;
  verticals: VerticalRow[];
  bigTest: BigTest;
}

type Loop = "tool" | "gtm";
const LOOP_LABEL: Record<Loop, string> = {
  tool: "Smarter tool",
  gtm: "Smarter GTM",
};

/** The R3 discipline, made visible: which loop a section powers + the move it drives. */
function LoopNote({ loops, move }: { loops: Loop[]; move: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {loops.map((l) => (
          <Badge key={l} tone="neutral" size="sm">
            {LOOP_LABEL[l]}
          </Badge>
        ))}
      </div>
      <p className="max-w-md font-sans text-sm text-ink-muted">
        <span className="text-ink-strong">Drives:</span> {move}
      </p>
    </div>
  );
}

/** A white elevated panel floating on the blue — the shared scoreboard section shell. */
function SectionCard({
  title,
  loops,
  move,
  children,
}: {
  title: string;
  loops: Loop[];
  move: string;
  children: React.ReactNode;
}) {
  return (
    <Card variant="elevated" padding="lg">
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <SectionHeader title={title} size="h3" as="h2" />
          <LoopNote loops={loops} move={move} />
        </div>
        {children}
      </div>
    </Card>
  );
}

/** A quiet Inter micro-label — replaces the illegible mono-uppercase descriptor. */
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="font-sans text-sm text-ink-muted">{children}</span>;
}

export function ScoreboardView({ data }: { data: ScoreboardData }) {
  const [scope, setScope] = useState<FeedFilterValue>("all");
  const active = data.scopes[scope] ?? data.scopes.all;

  return (
    // The health-blue hero paints the whole page — same surface as the feed + brief.
    <div
      className="flex flex-1 flex-col"
      style={{ backgroundImage: gradients.healthHero }}
    >
      <TopNav tone="dark" />

      <PageContainer className="pb-2 pt-10">
        <div className="flex flex-col gap-6 rounded-card border border-white/25 bg-white/5 p-8 backdrop-blur-sm">
          <SectionHeader
            eyebrow="ROI Scoreboard"
            title={<>The impact of a buying&nbsp;moment GTM engine</>}
            tone="dark"
            size="h2"
            as="h1"
          />
          <SegmentedControl<FeedFilterValue>
            label="Scope the scoreboard by vertical"
            options={VERTICAL_FILTERS}
            value={scope}
            onValueChange={setScope}
            accent="brand"
          />
        </div>
      </PageContainer>

      <main className="flex flex-1 flex-col">
        <PageContainer className="pb-12 pt-6">
          <div className="flex flex-col gap-6">
            {/* ── The two lagging outcomes ─────────────────────────────── */}
            <div className="grid gap-6 md:grid-cols-2">
              {active.endGoals.map((m) => (
                <Card key={m.label} variant="elevated" padding="lg">
                  <StatTile
                    label={m.label}
                    value={m.value}
                    delta={m.delta}
                    deltaTone={m.deltaTone}
                    honesty={m.honesty}
                    caption={m.caption}
                  />
                </Card>
              ))}
            </div>

            {/* ── Leading signs ────────────────────────────────────────── */}
            <SectionCard
              title="Leading signs this month"
              loops={["tool", "gtm"]}
              move="the early numbers that move the two outcomes above — each one you can act on this week."
            >
              <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
                {active.leading.map((m) => (
                  <StatTile
                    key={m.label}
                    label={m.label}
                    value={m.value}
                    delta={m.delta}
                    deltaTone={m.deltaTone}
                    honesty={m.honesty}
                    caption={m.caption}
                  />
                ))}
              </div>
            </SectionCard>

            {/* ── Which signals turn into meetings? ────────────────────── */}
            <SectionCard
              title="Which signals turn into meetings?"
              loops={["tool", "gtm"]}
              move="keep or kill a signal and re-rank the feed · aim the team at the buying moments that pay off."
            >
              <div className="grid items-center gap-8 lg:grid-cols-[auto_1fr]">
                <StatRing
                  fraction={active.overallConversion}
                  accent="brand"
                  label="of tool-sourced leads become a meeting"
                />
                <div className="flex flex-col gap-5">
                  {active.signalConversion.map((s) => (
                    <Meter
                      key={s.kind}
                      label={s.label}
                      valueLabel={`${Math.round(s.rate * 100)}%`}
                      fraction={s.rate}
                      gradient={signalGradients[s.kind]}
                      caption={s.detail}
                    />
                  ))}
                </div>
              </div>
            </SectionCard>

            {/* ── Which specialties win fastest & cheapest? ────────────── */}
            <SectionCard
              title="Which specialties win fastest & cheapest?"
              loops={["tool", "gtm"]}
              move="sharpen each specialty's pitch · send the new team to the best specialties first."
            >
              <div className="flex flex-col gap-6">
                {data.verticals.map((v) => {
                  const highlighted = scope === v.slug;
                  return (
                    <div
                      key={v.slug}
                      className={
                        highlighted ? "rounded-panel bg-surface-subtle p-4" : undefined
                      }
                    >
                      <div className="grid items-center gap-4 sm:grid-cols-[minmax(9rem,1fr)_2fr_auto]">
                        <span className="font-display text-h5 text-ink">{v.label}</span>
                        <Meter
                          label="Win rate"
                          valueLabel={`${Math.round(v.winRate * 100)}%`}
                          fraction={v.winRate}
                          tone="ink"
                        />
                        <div className="flex gap-6">
                          <div className="flex flex-col gap-0.5">
                            <FieldLabel>Cost / mtg</FieldLabel>
                            <span className="font-mono text-base tabular-nums text-ink">
                              {v.costPerMeeting}
                            </span>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <FieldLabel>Cycle</FieldLabel>
                            <span className="font-mono text-base tabular-nums text-ink">
                              {v.cycleDays}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </SectionCard>

            {/* ── AE feedback + the big test ───────────────────────────── */}
            <div className="grid gap-6 lg:grid-cols-2">
              {/* AE lead-quality feedback */}
              <SectionCard
                title="Did the AE mark it good?"
                loops={["tool"]}
                move="learn what a good lead looks like → find more of them, waste less."
              >
                <div className="flex flex-col gap-5">
                  <div className="flex items-end gap-4">
                    <span className="font-display text-h2 font-book tracking-brand text-ink">
                      {Math.round(active.feedback.thumbsUpRate * 100)}%
                    </span>
                    <span className="pb-2 font-sans text-sm text-ink-muted">
                      marked 👍 good ({active.feedback.total} rated)
                    </span>
                  </div>
                  <Meter
                    label="Good leads"
                    valueLabel={`${Math.round(active.feedback.thumbsUpRate * 100)}%`}
                    fraction={active.feedback.thumbsUpRate}
                    tone="ink"
                  />
                  <div className="flex flex-col gap-2">
                    <FieldLabel>Why 👎, one tap</FieldLabel>
                    <div className="flex flex-wrap gap-2">
                      {active.feedback.reasons.map((r) => (
                        <span
                          key={r.label}
                          className="inline-flex w-fit items-center gap-2 rounded-pill bg-surface-subtle px-4 py-1.5 font-sans text-sm text-ink-strong"
                        >
                          {r.label}
                          <span className="font-mono text-xs tabular-nums text-ink-faint">
                            {r.count}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </SectionCard>

              {/* The big test — the validation experiment, not an assumed number */}
              <Card variant="elevated" padding="lg">
                <div className="flex flex-col gap-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <SectionHeader
                      eyebrow="The big test"
                      title="Buying-moment vs cold list"
                      size="h3"
                      as="h2"
                    />
                    <Badge tone="warn" size="sm">
                      Measuring now
                    </Badge>
                  </div>
                  <p className="font-sans text-sm text-ink-muted">
                    Not a hero number — the experiment the tool is built to run: same
                    team, same weeks, timing-sourced leads against a cold / demographic
                    list.
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-2 rounded-panel bg-surface-subtle p-4">
                      <FieldLabel>Buying-moment</FieldLabel>
                      <span className="font-display text-h3 font-book tracking-brand text-ink">
                        {data.bigTest.buyingMoment.meetings}
                      </span>
                      <span className="font-sans text-sm text-ink-muted">
                        meetings · {data.bigTest.buyingMoment.deals} deals
                      </span>
                    </div>
                    <div className="flex flex-col gap-2 rounded-panel bg-surface-subtle p-4">
                      <FieldLabel>Cold list</FieldLabel>
                      <span className="font-display text-h3 font-book tracking-brand text-ink">
                        {data.bigTest.cold.meetings}
                      </span>
                      <span className="font-sans text-sm text-ink-muted">
                        meetings · {data.bigTest.cold.deals} deals
                      </span>
                    </div>
                  </div>
                  <p className="font-sans text-sm text-ink-muted">
                    <span className="text-ink-strong">Drives:</span> decide whether to
                    bet bigger on timing-based sourcing.
                  </p>
                </div>
              </Card>
            </div>
          </div>
        </PageContainer>
      </main>
    </div>
  );
}
