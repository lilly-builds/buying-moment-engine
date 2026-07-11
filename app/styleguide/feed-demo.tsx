"use client";

import { useState } from "react";
import {
  Button,
  Card,
  FreshnessClock,
  SectionHeader,
  SegmentedControl,
  SignalPill,
  type SignalKind,
} from "@/design/components";

/**
 * The composed feed — U8's screen in miniature, built only from the kit.
 *
 * It is a client island because the vertical filter is real: the SegmentedControl
 * actually filters the rows. A filter that doesn't filter would be a lie in a
 * document whose whole job is to be trusted.
 */

/** The four EliseAI healthcare verticals (D6), plus the default. */
const VERTICALS = [
  { value: "all", label: "All" },
  { value: "dermatology", label: "Dermatology" },
  { value: "womens-health", label: "Women's Health" },
  { value: "ophthalmology", label: "Ophthalmology" },
  { value: "orthopedics", label: "Orthopedics" },
] as const;

type Vertical = (typeof VERTICALS)[number]["value"];

/**
 * Illustrative rows — layout fixtures for this page only, never a claim about a real
 * practice. The live feed reads from Postgres (R1/R7); nothing here does. The names
 * are invented placeholders; swap them for real practices only through the database.
 *
 * `vertical` is DATA, not display: it drives the filter, but the row never renders it.
 * "Cedarline Dermatology Group" already names the vertical — printing a `Dermatology`
 * tag beside it says the same thing twice, which is what makes a row look busy.
 */
const FEED_SAMPLE: ReadonlyArray<{
  practice: string;
  vertical: Exclude<Vertical, "all">;
  signals: SignalKind[];
  days: number;
}> = [
  {
    practice: "Cedarline Dermatology Group",
    vertical: "dermatology",
    signals: ["staffing-spike", "phone-complaints", "growth-events"],
    days: 2,
  },
  {
    practice: "Harborlight Women's Health",
    vertical: "womens-health",
    signals: ["staffing-spike", "phone-complaints"],
    days: 6,
  },
  {
    practice: "Meridian Eye Care Associates",
    vertical: "ophthalmology",
    signals: ["growth-events"],
    days: 34,
  },
];

/**
 * One feed card.
 *
 *   Card `flat`      = `.feature-card-opt1`: #fafafb fill, 12px radius, no border, no
 *                      shadow. Twenty stack calmly; a flat fill has no edge to fight.
 *   heading          = the PRACTICE, first. Inter Tight 450, tight tracking. The AE
 *                      scans a feed for who to call; the pills beneath say why.
 *   SignalPill       = the fired signals, one gradient per kind, sized a step below
 *                      the name because they qualify it. The pills ARE the buying
 *                      moment, and showing them IS showing the count (D8) — a
 *                      "3 signals" badge would say once more what the row says.
 *   FreshnessClock   = age swept across the 7-day window. Quiet ink inside it, red out.
 *   Button `primary` = `.primary-btn`, their filled purple. Opening the brief is the
 *                      ONE action on a row, so it takes the primary.
 *
 * Nothing else. No vertical tag (the name says it, the filter acts on it), no location
 * line, no separate headline. Two objects and an action.
 */
function FeedCard({ row }: { row: (typeof FEED_SAMPLE)[number] }) {
  return (
    <Card variant="flat" padding="md">
      <div className="flex flex-wrap items-center justify-between gap-8">
        <div className="flex min-w-0 flex-col gap-3">
          <h4 className="font-display text-h5 text-ink">{row.practice}</h4>

          <div className="flex flex-wrap items-center gap-2">
            {row.signals.map((kind) => (
              <SignalPill key={kind} kind={kind} />
            ))}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-6">
          <FreshnessClock days={row.days} />
          <Button variant="primary" size="sm">
            View brief
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function FeedDemo() {
  const [vertical, setVertical] = useState<Vertical>("all");

  const rows =
    vertical === "all"
      ? FEED_SAMPLE
      : FEED_SAMPLE.filter((r) => r.vertical === vertical);

  return (
    // The same container the top-nav demo uses: `rounded-card` + `overflow-hidden`
    // over the health-hero gradient. Header, filter, and feed all sit inside it, so
    // the feed reads as one contained surface rather than loose rows on the page.
    <div className="gradient-hero relative overflow-hidden rounded-card">
      {/* 56px — the same inset EliseAI pads `.new-nav-fixed` with. */}
      <div className="flex flex-col gap-8 p-14">
        {/* `tone="dark"` — the title sits on a blue surface, so it takes white ink. */}
        <SectionHeader
          title="Prospects at a buying moment"
          tone="dark"
          size="h4"
          as="h3"
          action={
            <SegmentedControl<Vertical>
              label="Filter feed by vertical"
              options={VERTICALS}
              value={vertical}
              onValueChange={setVertical}
            />
          }
        />

        <div className="flex flex-col gap-4">
          {rows.length > 0 ? (
            rows.map((row) => <FeedCard key={row.practice} row={row} />)
          ) : (
            // U8 needs a designed empty state, not a blank screen. Filter to
            // Orthopedics to see it.
            <Card variant="flat" padding="lg">
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <p className="font-display text-h5 text-ink">
                  No prospects at a buying moment here yet
                </p>
                <p className="max-w-text font-sans text-base text-ink-body">
                  Detectors haven&apos;t surfaced a signal in this vertical. Widen the
                  freshness window, or check back after the next run.
                </p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
