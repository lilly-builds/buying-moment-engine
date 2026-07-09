"use client";

import { useState } from "react";
import {
  Badge,
  ButtonLink,
  Card,
  PageContainer,
  SectionHeader,
  SegmentedControl,
  SignalPill,
  SourceLink,
  TopNav,
} from "@/design/components";
import { gradients } from "@/design/tokens";
import type { RenderedBrief, FiredSignal } from "@/src/brief/render";
import { windowDaysFor } from "@/src/brief/render";
import { toSignalKind } from "@/src/ui/signal-display";

/**
 * The deep brief (U9) — the card an AE opens from the feed, built to D7's two tiers:
 * ⚡ the outreach an AE sends, and 📋 the call prep they read before dialling. A
 * SegmentedControl at the top lets the salesperson pick which they're working —
 * "Outreach emails" or "Call prep" — the same control the styleguide ships and the
 * scoreboard uses for its scope toggle.
 *
 * The surface matches the feed on purpose (Lilly, 2026-07-08): the health-blue hero
 * paints the whole page, and the working panels are white ELEVATED cards floating on
 * it. (An owner call over rules.ts's "repeated items are flat" — these are a handful
 * of large panels, not a 20-row list.)
 *
 * A client island because the mode toggles and the 3-touch sequence is directly
 * editable (D7). Time-sensitive fields — fired-signal list, freshness, per-signal age
 * — come from `brief.live`, computed fresh at request time; nothing trusts a stored
 * badge. `nowMs` is passed from the server so "N days ago" is stable across hydrate.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function agoLabel(date: Date, nowMs: number): string {
  const days = Math.max(0, Math.floor((nowMs - date.getTime()) / DAY_MS));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

const CHANNEL_LABEL: Record<string, string> = {
  email: "Email",
  call: "Call",
  linkedin: "LinkedIn",
};

type BriefMode = "outreach" | "prep";

// Action-phrased, so the toggle reads as "what do you want to do" (Lilly, 2026-07-08).
const MODE_OPTIONS = [
  { value: "outreach", label: "Send email" },
  { value: "prep", label: "Prep for call" },
] as const;

/** A cited fact row — label, value, and the D2 source link. Value is never quoted. */
function ClaimRow({
  label,
  value,
  quote,
  href,
}: {
  label: string;
  value: string;
  quote: string | null;
  href: string;
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-line-soft pb-4 last:border-0 last:pb-0">
      <span className="font-sans text-sm text-ink-muted">
        {label}
      </span>
      <p className="font-sans text-base text-ink">{value}</p>
      {quote ? (
        <p className="font-sans text-sm italic text-ink-muted">
          &ldquo;{quote}&rdquo;{" "}
          <SourceLink href={href} className="text-sm not-italic">
            source
          </SourceLink>
        </p>
      ) : (
        <SourceLink href={href} className="w-fit text-sm">
          source
        </SourceLink>
      )}
    </div>
  );
}

/** One editable touch in the 3-touch sequence. Genuinely editable — uncontrolled fields. */
function TouchEditor({ touch }: { touch: RenderedBrief["voice"]["sequence"]["touches"][number] }) {
  const rows = Math.max(4, touch.body.split("\n").length + 3);
  return (
    <div className="flex flex-col gap-3 rounded-panel bg-surface-subtle p-4">
      <div className="flex items-center gap-2">
        <Badge tone="neutral" size="sm">
          Touch {touch.touchNumber}
        </Badge>
        <Badge tone="neutral" size="sm">
          {CHANNEL_LABEL[touch.channel] ?? touch.channel}
        </Badge>
      </div>
      {touch.channel === "call" ? (
        <textarea
          aria-label={`Touch ${touch.touchNumber} notes`}
          defaultValue={touch.body}
          rows={rows}
          className="w-full resize-y rounded-panel border-0 bg-surface p-3 font-sans text-sm text-ink-body outline-none focus-visible:ring-2 focus-visible:ring-brand"
        />
      ) : (
        <>
          <input
            aria-label={`Touch ${touch.touchNumber} subject`}
            defaultValue={touch.subject}
            className="w-full rounded-panel border-0 bg-surface px-3 py-2 font-sans text-sm font-book text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand"
          />
          <textarea
            aria-label={`Touch ${touch.touchNumber} body`}
            defaultValue={touch.body}
            rows={rows}
            className="w-full resize-y rounded-panel border-0 bg-surface p-3 font-sans text-sm text-ink-body outline-none focus-visible:ring-2 focus-visible:ring-brand"
          />
        </>
      )}
    </div>
  );
}

/**
 * The buying-moment detail — each fired signal with its source, freshness, confidence.
 * "View evidence" leads (a chip beside the pill) because clicking it is what PROVES the
 * confidence; the confidence score trails on the right as quiet text (Lilly, 2026-07-08).
 */
function SignalDetail({ signal, nowMs }: { signal: FiredSignal; nowMs: number }) {
  const pillKind = toSignalKind(signal.kind);
  const windowDays = windowDaysFor(signal.kind);
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line-soft pb-4 last:border-0 last:pb-0">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {pillKind ? <SignalPill kind={pillKind} size="md" /> : null}
          {/* A compact outlined chip — deliberately a step smaller than the pill, so
              the signal reads as the subject and "view evidence" as its affordance. */}
          <a
            href={signal.href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center rounded-pill border border-line-outline px-3.5 py-1 font-sans text-sm text-brand transition-colors hover:border-line-outline-hover hover:text-brand-hover-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            View evidence
          </a>
        </div>
        <p className="font-sans text-sm text-ink-muted">
          {signal.signalSource ? `${signal.signalSource} · ` : ""}
          detected {agoLabel(signal.detectedAt, nowMs)} · stays hot {windowDays} days
        </p>
      </div>
      {signal.confidence !== null ? (
        <span className="font-sans text-sm text-ink-muted">
          {Math.round(signal.confidence * 100)}% confidence
        </span>
      ) : null}
    </div>
  );
}

/** ⚡ Outreach mode — who to reach, and the message that goes out. */
function OutreachMode({ brief }: { brief: RenderedBrief }) {
  const { factual, voice } = brief;
  const contact = factual.contact;
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      {/* Who to contact */}
      <Card variant="elevated" padding="lg" className="lg:col-span-2">
        <div className="flex h-full flex-col gap-5">
          <SectionHeader title="Who to contact" size="h3" as="h2" />
          {contact ? (
            <>
              <div className="flex flex-col gap-1">
                <p className="font-display text-h5 text-ink">
                  {contact.name ?? "Decision-maker (name not public)"}
                </p>
                <p className="font-sans text-base text-ink-body">{contact.role}</p>
              </div>

              <div className="flex flex-col gap-3">
                {contact.email ? (
                  <div className="flex flex-col gap-0.5">
                    <span className="font-sans text-sm text-ink-muted">
                      Email{contact.emailProvider === "pdl" ? " · verified" : ""}
                    </span>
                    <p className="font-sans text-base text-ink">{contact.email}</p>
                  </div>
                ) : null}
                {contact.bestChannel ? (
                  <div className="flex flex-col gap-0.5">
                    <span className="font-sans text-sm text-ink-muted">
                      Best channel
                    </span>
                    <p className="font-sans text-base text-ink">{contact.bestChannel}</p>
                  </div>
                ) : null}
              </div>

              <div className="mt-auto flex flex-col gap-3">
                <p className="font-sans text-sm text-ink-muted">
                  Check for mutual connections before you reach out:
                </p>
                <div className="flex flex-wrap gap-3">
                  <ButtonLink
                    variant="secondary"
                    size="sm"
                    href={contact.linkedinHref}
                    target="_blank"
                    rel="noreferrer"
                  >
                    LinkedIn
                  </ButtonLink>
                  <ButtonLink
                    variant="secondary"
                    size="sm"
                    href={contact.facebookHref}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Facebook
                  </ButtonLink>
                </div>
              </div>
            </>
          ) : (
            <p className="font-sans text-base text-ink-body">
              No public decision-maker surfaced yet — reach the practice on its main
              line and ask for the practice manager.
            </p>
          )}
        </div>
      </Card>

      {/* Recommended action */}
      <Card variant="elevated" padding="lg" className="lg:col-span-3">
        <div className="flex flex-col gap-5">
          <SectionHeader
            title="Recommended action"
            size="h3"
            as="h2"
            action={
              <ButtonLink variant="primary" size="sm" href="#send">
                {voice.sequence.namedCta}
              </ButtonLink>
            }
          />

          <div className="flex flex-col gap-2">
            <span className="font-sans text-sm text-ink-muted">
              Call opener
            </span>
            <p className="rounded-panel bg-brand-50 p-4 font-sans text-base text-ink">
              {voice.callOpener}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <span className="font-sans text-sm text-ink-muted">
              3-touch sequence · editable
            </span>
            <div className="flex flex-col gap-3">
              {voice.sequence.touches.map((touch) => (
                <TouchEditor key={touch.touchNumber} touch={touch} />
              ))}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

/** 📋 Call-prep mode — everything to sound like a veteran once they pick up. */
function PrepMode({ brief, nowMs }: { brief: RenderedBrief; nowMs: number }) {
  const { factual, voice, live } = brief;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* The buying moment */}
      <Card variant="elevated" padding="lg" className="lg:col-span-2">
        <div className="flex flex-col gap-5">
          <SectionHeader title="The buying moment" size="h3" as="h3" />
          <div className="flex flex-col gap-4">
            {live.firedSignals.map((signal) => (
              <SignalDetail key={signal.evidenceId} signal={signal} nowMs={nowMs} />
            ))}
          </div>
        </div>
      </Card>

      {/* Practice profile */}
      <Card variant="elevated" padding="lg">
        <div className="flex flex-col gap-5">
          <SectionHeader title="Practice profile" size="h3" as="h3" />
          <div className="flex flex-col gap-4">
            {factual.profile.map((c) => (
              <ClaimRow key={c.label} {...c} />
            ))}
          </div>
        </div>
      </Card>

      {/* Incumbent tooling */}
      <Card variant="elevated" padding="lg">
        <div className="flex flex-col gap-5">
          <SectionHeader title="Incumbent tooling" size="h3" as="h3" />
          <div className="flex flex-col gap-4">
            {factual.incumbentTooling.map((c) => (
              <ClaimRow key={c.label} {...c} />
            ))}
          </div>
        </div>
      </Card>

      {/* EliseAI fit + proof + ROI */}
      <Card variant="elevated" padding="lg" className="lg:col-span-2">
        <div className="flex flex-col gap-6">
          <SectionHeader title="Why EliseAI fits" size="h3" as="h3" />
          <p className="max-w-3xl font-sans text-base text-ink-body">{factual.painFit}</p>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Proof point */}
            <div className="flex flex-col gap-3 rounded-panel bg-surface-subtle p-5">
              <div className="flex items-center gap-2">
                <span className="font-sans text-sm text-ink-muted">
                  Proof point
                </span>
                <Badge tone="neutral" size="sm">
                  Measured
                </Badge>
              </div>
              {factual.proofPoint.tag === "real" ? (
                <>
                  <p className="font-display text-h5 text-ink">
                    {factual.proofPoint.caseStudy}
                  </p>
                  <ul className="flex flex-col gap-1.5">
                    {factual.proofPoint.metrics.map((m) => (
                      <li key={m} className="font-sans text-sm text-ink-body">
                        {m}
                      </li>
                    ))}
                  </ul>
                  <SourceLink href={factual.proofPoint.href} className="w-fit text-sm">
                    Read the customer story
                  </SourceLink>
                </>
              ) : (
                <p className="font-sans text-sm text-ink-muted">
                  Proof pending — no customer-success metric found for this vertical yet.
                </p>
              )}
            </div>

            {/* ROI range */}
            <div className="flex flex-col gap-3 rounded-panel bg-surface-subtle p-5">
              <div className="flex items-center gap-2">
                <span className="font-sans text-sm text-ink-muted">
                  ROI range
                </span>
                <Badge tone="neutral" size="sm">
                  Modeled
                </Badge>
              </div>
              <ul className="flex flex-col gap-3">
                {factual.roiRange.items.map((item) => (
                  <li key={item.label} className="flex flex-col gap-1">
                    <span className="font-sans text-sm text-ink-body">{item.label}</span>
                    <SourceLink href={item.href} className="w-fit text-sm">
                      source
                    </SourceLink>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </Card>

      {/* Discovery questions */}
      <Card variant="elevated" padding="lg">
        <div className="flex flex-col gap-5">
          <SectionHeader title="Discovery questions" size="h3" as="h3" />
          <ol className="flex flex-col gap-4">
            {voice.discoveryQuestions.map((q, i) => (
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
          <SectionHeader title="Objections & rebuttals" size="h3" as="h3" />
          <div className="flex flex-col gap-4">
            {voice.objections.map((o) => (
              <div
                key={o.objection}
                className="flex flex-col gap-1.5 border-b border-line-soft pb-4 last:border-0 last:pb-0"
              >
                <p className="font-sans text-base font-book text-ink">“{o.objection}”</p>
                <p className="font-sans text-sm text-ink-body">{o.rebuttal}</p>
              </div>
            ))}
          </div>
        </div>
      </Card>

    </div>
  );
}

export function BriefView({ brief, nowMs }: { brief: RenderedBrief; nowMs: number }) {
  const [mode, setMode] = useState<BriefMode>("outreach");
  const { factual } = brief;
  const location = [factual.city, factual.state].filter(Boolean).join(", ");

  return (
    // The health-blue hero paints the whole page — same surface as the feed.
    <div
      className="flex flex-1 flex-col"
      style={{ backgroundImage: gradients.healthHero }}
    >
      <TopNav tone="dark" />

      {/* Hero — the buying-moment headline is the spine (D1), and the mode toggle.
          Held in an outlined glass panel so it reads as a contained surface on the
          blue rather than raw text floating on it (Lilly, 2026-07-08). */}
      <PageContainer className="pb-2 pt-10">
        <div className="flex flex-col gap-6 rounded-card border border-white/25 bg-white/5 p-8 backdrop-blur-sm">
          <div className="flex flex-col gap-3">
            <span className="font-sans text-base font-medium uppercase tracking-eyebrow text-white">
              {factual.practiceName}
              {location ? ` · ${location}` : ""}
            </span>
            <h1 className="max-w-3xl font-display text-h2 font-book tracking-brand text-balance text-white">
              {brief.headline}
            </h1>
          </div>

          <SegmentedControl<BriefMode>
            label="Choose what to work on this brief"
            options={MODE_OPTIONS}
            value={mode}
            onValueChange={setMode}
            accent="brand"
          />
        </div>
      </PageContainer>

      <main className="flex flex-1 flex-col">
        <PageContainer className="pb-12 pt-6">
          {mode === "outreach" ? (
            <OutreachMode brief={brief} />
          ) : (
            <PrepMode brief={brief} nowMs={nowMs} />
          )}
        </PageContainer>
      </main>
    </div>
  );
}
