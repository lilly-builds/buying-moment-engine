"use client";

import { useState } from "react";
import {
  Badge,
  ButtonLink,
  Card,
  PageContainer,
  SectionHeader,
  SegmentedControl,
  Tag,
  TopNav,
} from "@/design/components";
import type { WorkspaceConfig } from "@/src/workspace/schema";
import { SampleSignalPill } from "../../sample-signal-pill";

/**
 * The sample brief (Adapt-It P4) — the two-tier card an AE opens from the tenant
 * feed, the sample-feed sibling of the DB-backed `app/brief-view.tsx`.
 *
 * It mirrors that brief's craft and surface: the buying-moment headline owns a
 * glass hero on the health-blue page, a SegmentedControl picks which tier the AE is
 * working, and the working panels are white elevated cards. What differs is the
 * SHAPE: this renders the simpler generated `SampleProspect.brief` (who to contact,
 * one recommended action, and the call-prep prose) rather than the live signal /
 * send / ROI machinery of the real brief.
 *
 * Two tiers, one decision at a time (north star law 1):
 *   - At a glance — who to reach, how, the personalization line, and the one
 *     recommended action.
 *   - Call prep — why it fits, the proof line, the discovery questions, and the
 *     objections with rebuttals.
 *
 * Nothing here sends; a sample brief is a preview of the engine's output. The one
 * action is "Copy the opener" (client-only), so the screen still has a single,
 * obvious primary without wiring an outbound path.
 */

type SampleProspect = WorkspaceConfig["sampleFeed"][number];

type BriefTier = "glance" | "prep";

const TIER_OPTIONS = [
  { value: "glance", label: "At a glance" },
  { value: "prep", label: "Call prep" },
] as const;

export function SampleBriefView({ prospect }: { prospect: SampleProspect }) {
  const [tier, setTier] = useState<BriefTier>("glance");

  return (
    // The health-blue hero paints the whole page — the same surface as the feed.
    <div className="gradient-hero flex flex-1 flex-col">
      <TopNav tone="dark" />

      {/* Hero — the buying-moment headline is the spine, held in a glass panel so it
          reads as a contained surface on the blue (matches app/brief-view.tsx). */}
      <PageContainer className="pb-2 pt-10">
        <div className="flex flex-col gap-6 rounded-card border border-white/25 bg-white/5 p-8 backdrop-blur-sm">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <span className="font-sans text-base font-medium uppercase tracking-eyebrow text-white">
                {prospect.name}
              </span>
              <div className="w-fit shrink-0">
                <SegmentedControl<BriefTier>
                  label="Choose what to work on this brief"
                  options={TIER_OPTIONS}
                  value={tier}
                  onValueChange={setTier}
                  accent="brand"
                />
              </div>
            </div>
            <h1 className="max-w-3xl font-display text-h2 font-book tracking-brand text-balance text-white">
              {prospect.headline}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              {prospect.signals.map((signal) => (
                <SampleSignalPill key={signal.name} name={signal.name} size="md" />
              ))}
              <Badge tone="neutral" size="sm">
                {prospect.freshnessLabel}
              </Badge>
            </div>
          </div>
        </div>
      </PageContainer>

      <main className="flex flex-1 flex-col">
        <PageContainer className="flex flex-col gap-6 pb-12 pt-6">
          {tier === "glance" ? (
            <GlanceTier prospect={prospect} />
          ) : (
            <PrepTier prospect={prospect} />
          )}
          <div>
            {/* On the blue hero field the `secondary` (transparent, purple ink,
                faint border) reads as a near-invisible outline. `primary-dark` is
                the kit's dark-surface control — a white fill with dark ink — so a
                single, calm back affordance stays legible. */}
            <ButtonLink href="/" variant="primary-dark" size="md">
              Back to the feed
            </ButtonLink>
          </div>
        </PageContainer>
      </main>
    </div>
  );
}

/** At a glance — who to reach and the one thing to do next. */
function GlanceTier({ prospect }: { prospect: SampleProspect }) {
  const { whoToContact: contact, recommendedAction } = prospect.brief;
  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      {/* Who to contact */}
      <Card variant="elevated" padding="lg">
        <div className="flex flex-col gap-5">
          <SectionHeader title="Who to contact" size="h3" as="h2" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Card variant="flat" padding="md">
              <div className="flex flex-col gap-0.5">
                <p className="font-display text-h5 text-ink">{contact.name}</p>
                <p className="font-sans text-base text-ink-body">{contact.role}</p>
              </div>
            </Card>
            <Card variant="flat" padding="md">
              <div className="flex flex-col items-start gap-1.5">
                <Tag tone="brand" className="px-3 py-1 text-xs">
                  Best channel
                </Tag>
                <p className="font-sans text-base text-ink">{contact.channel}</p>
              </div>
            </Card>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="font-sans text-sm text-ink-muted">How to open</span>
            <p className="rounded-panel bg-brand-50 p-4 font-sans text-base text-ink">
              {contact.personalization}
            </p>
          </div>
        </div>
      </Card>

      {/* Recommended action — the one next step. */}
      <Card variant="elevated" padding="lg">
        <div className="flex flex-col gap-4">
          <SectionHeader
            eyebrow="Do this next"
            title="Recommended action"
            size="h3"
            as="h2"
          />
          <p className="font-sans text-lg text-ink-body">{recommendedAction}</p>
        </div>
      </Card>
    </div>
  );
}

/** Call prep — why it fits and what to say once they pick up. */
function PrepTier({ prospect }: { prospect: SampleProspect }) {
  const { painFit, proofLine, discoveryQuestions, objections } = prospect.brief;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Why it fits */}
      <Card variant="elevated" padding="lg" className="lg:col-span-2">
        <div className="flex flex-col gap-5">
          <SectionHeader title="Why this fits" size="h3" as="h2" />
          <p className="max-w-3xl font-sans text-base text-ink-body">{painFit}</p>
          <div className="flex flex-col gap-2 rounded-panel bg-surface-subtle p-5">
            <div className="flex items-center gap-2">
              <span className="font-sans text-sm text-ink-muted">Proof point</span>
              <Badge tone="neutral" size="sm">
                Your proof
              </Badge>
            </div>
            <p className="font-sans text-base text-ink">{proofLine}</p>
          </div>
        </div>
      </Card>

      {/* Discovery questions */}
      <Card variant="elevated" padding="lg">
        <div className="flex flex-col gap-5">
          <SectionHeader title="Discovery questions" size="h3" as="h2" />
          <ol className="flex flex-col gap-4">
            {discoveryQuestions.map((q, i) => (
              <li key={q} className="flex gap-3">
                <span className="font-mono text-sm text-ink-faint">{i + 1}</span>
                <span className="font-sans text-base text-ink-body">{q}</span>
              </li>
            ))}
          </ol>
        </div>
      </Card>

      {/* Objections + rebuttals */}
      <Card variant="elevated" padding="lg">
        <div className="flex flex-col gap-5">
          <SectionHeader title="Objections & rebuttals" size="h3" as="h2" />
          <div className="flex flex-col gap-4">
            {objections.map((o) => (
              <div
                key={o.q}
                className="flex flex-col gap-1.5 border-b border-line-soft pb-4 last:border-0 last:pb-0"
              >
                <p className="font-sans text-base font-book text-ink">&ldquo;{o.q}&rdquo;</p>
                <p className="font-sans text-sm text-ink-body">{o.rebuttal}</p>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
