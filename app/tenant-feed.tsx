"use client";

import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Input,
  SectionHeader,
  SegmentedControl,
} from "@/design/components";
import type { WorkspaceConfig } from "@/src/workspace/schema";
import { SampleSignalPill } from "./sample-signal-pill";

/**
 * The tenant feed (Adapt-It P4) — a workspace's generated `sampleFeed` rendered in
 * the SAME visual language as the EliseAI practices feed (`app/feed.tsx`): a flat
 * white row per prospect, the name as the heading, the buying-moment signals as
 * pills beneath it, a freshness chip and a "View brief" action on the right.
 *
 * A client island for the same reason the real feed is one: the signal filter and
 * the name search are real controls (design/rules.ts: "a control must actually
 * work"). The server component (`app/page.tsx`) hands down plain data; this only
 * filters, ranks, and renders.
 *
 * Ranked by how many signals are firing (most first), the same rank key the real
 * feed uses (`db/queries.ts` sorts by signal count). A tenant prospect carries a
 * `freshnessLabel` string rather than a detected-at date, so the tie-break is the
 * stable input order, not a clock.
 *
 * These are AI-generated EXAMPLES for the tenant's engine, not real companies — an
 * honest "Sample prospects" chip says so, so nothing here is mistaken for a live
 * detection.
 */

type SampleProspect = WorkspaceConfig["sampleFeed"][number];

const ALL = "__all__";

export interface TenantFeedProps {
  prospects: SampleProspect[];
  /** The tenant's product name, for the honest sample-prospects note. */
  productName: string;
}

/** One tenant feed row — mirrors `app/feed.tsx`'s FeedCard for a sample prospect. */
function TenantFeedCard({
  prospect,
  index = 0,
}: {
  prospect: SampleProspect;
  index?: number;
}) {
  return (
    // `raised` for quiet depth on the blue; capped stagger glide-in like the real feed.
    <Card
      variant="raised"
      padding="md"
      className="animate-card-glide-in"
      style={{ animationDelay: `${Math.min(index, 10) * 55}ms` }}
    >
      <div className="flex flex-wrap items-center justify-between gap-8">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h4 className="font-display text-h5 text-ink">{prospect.name}</h4>
            <p className="max-w-text font-sans text-base text-ink-body">{prospect.oneLine}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {prospect.signals.map((signal) => (
              <SampleSignalPill key={signal.name} name={signal.name} />
            ))}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-6">
          {/* Freshness is a recency STATE, so it rides a mono data Badge (design/rules:
              "a badge carries a number or a state"), not the day-count FreshnessClock —
              a sample prospect has a label like "3 days ago", not a detected-at date. */}
          <Badge tone="neutral" size="sm">
            {prospect.freshnessLabel}
          </Badge>
          <ButtonLink variant="primary" size="sm" href={`/prospect/${prospect.id}`}>
            View brief
          </ButtonLink>
        </div>
      </div>
    </Card>
  );
}

export function TenantFeed({ prospects, productName }: TenantFeedProps) {
  const [signal, setSignal] = useState<string>(ALL);
  const [query, setQuery] = useState("");

  // Rank once: most signals firing first, stable on the input order for ties.
  const ranked = useMemo(
    () => [...prospects].sort((a, b) => b.signals.length - a.signals.length),
    [prospects],
  );

  // Filter options = the distinct signal names actually present in the feed, so a
  // filter never offers a signal no prospect can match.
  const signalOptions = useMemo(() => {
    const names: string[] = [];
    for (const prospect of ranked) {
      for (const s of prospect.signals) {
        if (!names.includes(s.name)) names.push(s.name);
      }
    }
    return [{ value: ALL, label: "All signals" }, ...names.map((n) => ({ value: n, label: n }))];
  }, [ranked]);

  const bySignal =
    signal === ALL
      ? ranked
      : ranked.filter((p) => p.signals.some((s) => s.name === signal));

  const trimmed = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      trimmed
        ? bySignal.filter((p) => p.name.toLowerCase().includes(trimmed))
        : bySignal,
    [bySignal, trimmed],
  );

  const noMatch = trimmed.length > 0 && rows.length === 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <SectionHeader
          title="Prospects at a buying moment"
          tone="dark"
          size="h4"
          as="h2"
          action={<Badge tone="neutral">Sample prospects</Badge>}
        />
        <p className="max-w-text font-sans text-base text-white/80">
          {ranked.length === 1
            ? "1 prospect is hitting a buying moment right now."
            : `${ranked.length} prospects are hitting a buying moment right now.`}{" "}
          These are AI-generated examples for {productName}, so you can see the engine
          working before live signals come in.
        </p>
      </div>

      <div className="flex flex-col gap-3">
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

        {signalOptions.length > 1 ? (
          // Wrapped in an x-scroll track so a long signal name never pushes the
          // whole page into horizontal scroll on a narrow screen.
          <div className="max-w-full overflow-x-auto">
            <SegmentedControl<string>
              label="Filter your feed by buying-moment signal"
              options={signalOptions}
              value={signal}
              onValueChange={setSignal}
              accent="brand"
              size="sm"
            />
          </div>
        ) : null}

        {noMatch ? (
          <p className="font-sans text-sm text-white/80">
            No prospects in your feed match that name.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        {rows.length > 0 ? (
          rows.map((prospect, i) => (
            <TenantFeedCard key={prospect.id} prospect={prospect} index={i} />
          ))
        ) : (
          <Card variant="raised" padding="lg">
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <p className="font-display text-h5 text-ink">
                No prospects match this signal yet
              </p>
              <p className="max-w-text font-sans text-base text-ink-body">
                Clear the filter to see every prospect the engine surfaced for you.
              </p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
