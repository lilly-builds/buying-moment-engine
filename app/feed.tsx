"use client";

import { useMemo, useState } from "react";
import {
  Button,
  ButtonLink,
  Card,
  FreshnessClock,
  Input,
  SectionHeader,
  SegmentedControl,
  SignalPill,
} from "@/design/components";
import { windowDaysFor } from "@/src/engine/freshness";
import type { DetectorKind } from "@/src/ingest/validate";
import {
  toSignalKinds,
  VERTICAL_FILTERS,
  type FeedFilterValue,
  type VerticalSlug,
} from "@/src/ui/signal-display";

/**
 * The prospect feed (U8) — the hero screen, "handed a constant flow."
 *
 * A client island because the vertical filter is real (design rule: "a control in
 * the styleguide must actually work"). The server component (`page.tsx`) does the
 * query and hands down plain data; this only filters and renders.
 *
 * The composition is a direct port of `app/styleguide/feed-demo.tsx`, which Lilly
 * approved. The ONLY differences are that the rows are real (from Postgres, via the
 * server component) and the freshness clock is driven by each signal's real per-kind
 * window rather than a fixture `days` number. Nothing here invents layout the
 * approved design did not already have.
 */

/** One practice as the feed needs to draw it. Plain data — no Date methods called client-side beyond compare. */
export interface FeedItem {
  id: string;
  name: string;
  vertical: VerticalSlug;
  /** DB kinds, freshest first. Translated to paintable pills at render (drops `regulation`). */
  signalKinds: DetectorKind[];
  /** Age of the freshest signal in whole days, for the clock face. */
  freshestAgeDays: number;
  /** The freshest signal's kind — picks the correct per-kind freshness window. */
  freshestKind: DetectorKind;
  /** Whether the freshest signal is still inside its window. Decided server-side by `isFresh`. */
  freshestIsFresh: boolean;
}

export interface FeedProps {
  items: FeedItem[];
}

/**
 * One feed row. Two objects (name + why) and one action — nothing else. No vertical
 * tag (the name says it, the filter acts on it), no location line (that is a
 * call-prep decision, so it lives in the brief). See design/rules.ts.
 */
function FeedCard({ item, first = false }: { item: FeedItem; first?: boolean }) {
  const pills = toSignalKinds(item.signalKinds);
  const windowDays = windowDaysFor(item.freshestKind);

  const viewBrief = (
    <ButtonLink variant="primary" size="sm" href={`/practice/${item.id}`}>
      View brief
    </ButtonLink>
  );

  return (
    <Card variant="flat" padding="md">
      {/* Phone: name + signals stack, then the clock + action anchor to the
          bottom-right corner (`self-end`) so every row shares one clean action
          column. Desktop (sm:+) is the verified-live single justified row. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-8 sm:gap-y-8">
        <div className="flex min-w-0 flex-col gap-3">
          <h4 className="font-display text-h5 text-ink">{item.name}</h4>

          <div className="flex flex-wrap items-center gap-2">
            {pills.map((kind) => (
              <SignalPill key={kind} kind={kind} />
            ))}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-4 self-end sm:gap-6 sm:self-auto">
          {/* The clock's window is the freshest signal's OWN window (30/60/90d),
              not the component's 7-day default — a fresh staffing lead must not
              render red at day 10. Staleness is decided server-side by `isFresh`. */}
          <FreshnessClock
            days={item.freshestAgeDays}
            staleAfterDays={windowDays}
            stale={!item.freshestIsFresh}
          />
          {/* The tour spotlights the first row's action for step 2 ("Tap one to
              open it") — wrapped so the coach-through has a stable target. */}
          {first ? <span data-tour="open-brief">{viewBrief}</span> : viewBrief}
        </div>
      </div>
    </Card>
  );
}

export function Feed({ items }: FeedProps) {
  const [vertical, setVertical] = useState<FeedFilterValue>("all");
  const [query, setQuery] = useState("");

  const byVertical =
    vertical === "all"
      ? items
      : items.filter((item) => item.vertical === vertical);

  const trimmed = query.trim().toLowerCase();
  const rows = useMemo(
    () => (trimmed ? byVertical.filter((item) => item.name.toLowerCase().includes(trimmed)) : byVertical),
    [byVertical, trimmed],
  );

  const noMatch = trimmed.length > 0 && rows.length === 0;

  return (
    // Transparent: the health-blue hero is now the page surface (see app/page.tsx),
    // so the feed lays its dark-tone header and white flat rows straight onto the
    // blue. gap-8 between the header group and the rows; gap-4 between rows.
    <div className="flex flex-col gap-8">
      <SectionHeader
        title="Prospects at a buying moment"
        tone="dark"
        size="h4"
        as="h2"
        action={
          <SegmentedControl<FeedFilterValue>
            label="Filter feed by vertical"
            options={VERTICAL_FILTERS}
            value={vertical}
            onValueChange={setVertical}
            accent="brand"
          />
        }
      />

      {/* Search the feed by name — an obvious control, so the tour doesn't explain it. */}
      <div className="flex flex-col gap-2">
        <form
          onSubmit={(e) => e.preventDefault()}
          className="flex flex-wrap items-center gap-3 rounded-card bg-white/10 p-2 backdrop-blur-sm"
        >
          <Input
            aria-label="Search your feed by name"
            placeholder="Search your feed by name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-w-0 flex-1"
          />
          <Button type="submit" variant="primary" size="sm">
            Search
          </Button>
        </form>
        {noMatch ? (
          <p className="font-sans text-sm text-white/80">No leads in your feed match that name.</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        {rows.length > 0 ? (
          rows.map((item, i) =>
            i === 0 ? (
              // The tour spotlights the top of the list for step 1 ("Your hottest
              // leads are up top"). `first` also exposes the row's open-brief hook.
              <div key={item.id} data-tour="feed-top">
                <FeedCard item={item} first />
              </div>
            ) : (
              <FeedCard key={item.id} item={item} />
            ),
          )
        ) : (
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
  );
}
