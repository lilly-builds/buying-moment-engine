"use client";

import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  PageContainer,
  SectionHeader,
  SegmentedControl,
  SignalPill,
  SourceLink,
  Tag,
  TopNav,
} from "@/design/components";
import { LeadFeedback } from "@/design/components/brief/lead-feedback";
import { SendGate } from "@/design/components/brief/send-gate";
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
 * A client island because the mode toggles and the email sequence is directly
 * editable (D7). Time-sensitive fields — fired-signal list, freshness, per-signal age
 * — come from `brief.live`, computed fresh at request time; nothing trusts a stored
 * badge. `nowMs` is passed from the server so "N days ago" is stable across hydrate.
 *
 * The email Send button is CONDITIONAL on `sendConnected` (Lilly, final 2026-07-09):
 * HubSpot connected → the live send (U11) fires the real enrollment; not connected →
 * the named SendGate handoff routes the AE to the RevOps owner who turns sending on.
 * The two never coexist — one Send affordance, chosen by connection state.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function agoLabel(date: Date, nowMs: number): string {
  const days = Math.max(0, Math.floor((nowMs - date.getTime()) / DAY_MS));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

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

/** An editable touch, lifted into `OutreachMode` state so the Send button ships the AE's edits. */
type EditableTouch = {
  touchNumber: number;
  channel: string;
  subject: string;
  body: string;
};

type SendStatus = "idle" | "sending" | "sent" | "error";

function launchLabelFor(status: SendStatus): string {
  if (status === "sending") return "Sending…";
  if (status === "sent") return "Sent ✓";
  return "Send sequence";
}

/**
 * The email sequence's cadence, keyed by touch number (= the HubSpot Sequence email
 * step). These words MUST match the delays set on the live HubSpot Sequence — per
 * `onboarding/hubspot-setup-handoff.md`: email 1 on enroll · email 2 +1 business day ·
 * email 3 +3 business days. Shown to the AE so the app never claims a cadence HubSpot
 * won't actually send (Lilly, 2026-07-10). Keep this in sync with that sequence setup.
 * (The app-owned `src/send/cadence.ts` offsets govern a DIFFERENT, non-live path and
 * do not describe this HubSpot send.)
 */
const SEQUENCE_STEP: Record<number, { role: string; timing: string }> = {
  1: { role: "First email", timing: "sends now" },
  2: { role: "Follow-up 1", timing: "1 business day later" },
  3: { role: "Follow-up 2", timing: "3 business days later" },
};

/**
 * One editable email in the sequence — controlled, so its edits reach the send. Every
 * email's copy ships together via the ONE "Launch outreach" action below the list (a
 * contact enrolls once; the Sequence drips each email), so the editor carries no
 * per-email send button. `spotlight` marks the first email as the tour's "edit-email"
 * target. The sequence is EMAIL ONLY (Lilly, 2026-07-10): a phone call belongs in
 * Prep-for-call, so OutreachMode filters any non-email touch out before this renders.
 */
function TouchEditor({
  touch,
  onChange,
  step,
  spotlight = false,
}: {
  touch: EditableTouch;
  onChange: (patch: Partial<EditableTouch>) => void;
  /** This email's role + when it sends, so the card reads as one step of a sequence. */
  step: { role: string; timing: string };
  spotlight?: boolean;
}) {
  const rows = Math.max(4, touch.body.split("\n").length + 3);
  // Unique per email so each visible <label> binds to its own field (htmlFor/id).
  const subjectId = `touch-${touch.touchNumber}-subject`;
  const bodyId = `touch-${touch.touchNumber}-body`;
  return (
    <div
      data-tour={spotlight ? "edit-email" : undefined}
      className="flex flex-col gap-3 rounded-panel p-6"
      style={{ backgroundImage: gradients.brand }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-display text-h5 font-book text-ink-black">{step.role}</span>
        {step.timing ? (
          <Tag tone="brand" className="px-3 py-1 text-xs">
            {step.timing}
          </Tag>
        ) : null}
      </div>
      {/* Each field carries a VISIBLE label bound with htmlFor/id — so an AE never has
          to guess which box is the subject line and which is the email body. */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={subjectId} className="font-sans text-sm font-medium text-ink-black">
          Subject line
        </label>
        <input
          id={subjectId}
          value={touch.subject}
          onChange={(e) => onChange({ subject: e.target.value })}
          className="w-full rounded-panel border-0 bg-surface px-3 py-2 font-sans text-sm font-book text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={bodyId} className="font-sans text-sm font-medium text-ink-black">
          Message
        </label>
        <textarea
          id={bodyId}
          value={touch.body}
          onChange={(e) => onChange({ body: e.target.value })}
          rows={rows}
          className="w-full resize-y rounded-panel border-0 bg-surface p-3 font-sans text-sm text-ink-body outline-none focus-visible:ring-2 focus-visible:ring-brand"
        />
      </div>
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

/**
 * Who to contact — the decision-maker, shown in the hero glass panel (Lilly, 2026-07-10).
 * The title sits on the glass; each element is its OWN elevated white sub-card (name+role,
 * email, mutual-connections) so it reads as distinct boxes rather than loose text on blue.
 * "Best channel" was dropped as purposeless.
 */
function WhoToContact({
  contact,
}: {
  contact: RenderedBrief["factual"]["contact"];
}) {
  return (
    <Card variant="flat" padding="lg">
      <div className="flex flex-col gap-4">
        <SectionHeader title="Who to contact" size="h3" as="h2" />
        {contact ? (
          // Connections sized to its content (no empty space after Facebook); the freed
          // width goes to name + email so the name isn't squished (Lilly, 2026-07-10).
          <div className="grid gap-3 md:grid-cols-[1fr_1.2fr_auto]">
            <Card variant="elevated" padding="md">
              <div className="flex flex-col gap-0.5">
                <p className="font-display text-h5 text-ink">
                  {contact.name ?? "Decision-maker (name not public)"}
                </p>
                <p className="font-sans text-base text-ink-body">{contact.role}</p>
              </div>
            </Card>

            {contact.email ? (
              <Card variant="elevated" padding="md">
                <div className="flex flex-col items-start gap-1.5">
                  <Tag tone="brand" className="px-3 py-1 text-xs">
                    Email{contact.emailProvider === "pdl" ? " · verified" : ""}
                  </Tag>
                  <p className="font-sans text-base break-all text-ink">{contact.email}</p>
                </div>
              </Card>
            ) : null}

            <Card variant="elevated" padding="md">
              <div className="flex h-full flex-wrap items-center gap-3">
                <Tag tone="brand" className="px-3 py-1 text-xs">
                  Check for mutual connections:
                </Tag>
                <ButtonLink
                  variant="primary"
                  size="sm"
                  href={contact.linkedinHref}
                  target="_blank"
                  rel="noreferrer"
                >
                  LinkedIn
                </ButtonLink>
                <ButtonLink
                  variant="primary"
                  size="sm"
                  href={contact.facebookHref}
                  target="_blank"
                  rel="noreferrer"
                >
                  Facebook
                </ButtonLink>
              </div>
            </Card>
          </div>
        ) : (
          <Card variant="elevated" padding="md">
            <p className="font-sans text-base text-ink-body">
              No public decision-maker surfaced yet. Reach the practice on its main line
              and ask for the practice manager.
            </p>
          </Card>
        )}
      </div>
    </Card>
  );
}

/**
 * The SHARED "Sent" state for this practice, as render-safe primitives from the server
 * (`app/practice/[id]/page.tsx`). Its presence is what locks the Send button for EVERY
 * signed-in AE — not just the tab that sent — so the shared workspace can't double-send.
 */
export interface SentStateProp {
  status: "sending" | "sent";
  sentBy: string;
  /** Server-formatted date, e.g. "Jul 13, 2026"; null while still `sending`. */
  sentAtLabel: string | null;
}

/**
 * The button's opening state, derived from the shared send record. Already-sent → the
 * button starts locked and labelled with who/when; mid-send by another AE → locked too;
 * never sent → the normal idle button.
 */
function initialLaunch(sentState: SentStateProp | null | undefined): {
  status: SendStatus;
  message: string | null;
} {
  if (!sentState) return { status: "idle", message: null };
  if (sentState.status === "sent") {
    return {
      status: "sent",
      message: `Sent by ${sentState.sentBy}${
        sentState.sentAtLabel ? ` on ${sentState.sentAtLabel}` : ""
      }.`,
    };
  }
  // Claimed by someone but not yet confirmed — lock it so a 2nd AE can't pile on.
  return {
    status: "sending",
    message: `${sentState.sentBy} is sending this right now.`,
  };
}

/** The confirmation line after a successful send — who sent it and when, D9-safe. */
function sentSummary(sentBy?: string, sentAtIso?: string): string {
  const who = sentBy ? ` by ${sentBy}` : "";
  const label = sentAtIso ? formatSentDate(sentAtIso) : "";
  const when = label ? ` on ${label}` : "";
  return `Sent${who}${when}. The first email is on its way; the follow-ups send automatically through the connected inbox.`;
}

/** "Jul 13, 2026" from a send-response ISO string. Formatted client-side — this runs
 *  only after a click, never during initial render, so there's no hydration concern. */
function formatSentDate(sentAtIso: string): string {
  const d = new Date(sentAtIso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}

/** ⚡ Outreach mode — the message that goes out, full width. */
function OutreachMode({
  brief,
  practiceId,
  sendConnected,
  sentState,
}: {
  brief: RenderedBrief;
  practiceId: string;
  sendConnected: boolean;
  sentState?: SentStateProp | null;
}) {
  const { factual, voice } = brief;
  const contact = factual.contact;

  // The editable email sequence (D7), lifted into state so Launch ships the AE's exact
  // edited subject + body, not the stored draft. EMAIL ONLY (Lilly, 2026-07-10): a phone
  // call belongs in Prep-for-call, and every sent step maps 1:1 to a HubSpot email step —
  // so a non-email touch is filtered out here (new briefs are email-only by construction;
  // this also keeps any older stored brief's call step out of the send).
  const [touches, setTouches] = useState<EditableTouch[]>(() =>
    voice.sequence.touches
      .filter((t) => t.channel === "email")
      .map((t) => ({
        touchNumber: t.touchNumber,
        channel: t.channel,
        subject: t.subject,
        body: t.body,
      })),
  );
  // ONE launch state for the whole sequence — a contact enrolls once, so there is a
  // single button + status, never one per touch (a 2nd enroll 400s ALREADY_ENROLLED).
  // Seeded from the SHARED send record so an already-sent lead opens locked for everyone,
  // not just the tab that sent it (U11 shared-workspace guard).
  const [launch, setLaunch] = useState<{ status: SendStatus; message: string | null }>(
    () => initialLaunch(sentState),
  );

  function updateTouch(touchNumber: number, patch: Partial<EditableTouch>) {
    setTouches((prev) =>
      prev.map((t) => (t.touchNumber === touchNumber ? { ...t, ...patch } : t)),
    );
  }

  const hasEmail = Boolean(contact?.email);

  async function handleLaunch() {
    // Only EMAIL touches are emailed — a "call" touch's body is the AE's own call
    // prep, never customer copy, so it must never ship as an email. Each email touch
    // maps to its Sequence email step by touchNumber; call steps are rep tasks.
    const emailTouches = touches.filter((t) => t.channel === "email");
    // Guard client-side so a blanked field dead-ends here with a NAMED touch, not as
    // an opaque server 400 on the whole launch.
    const blank = emailTouches.find(
      (t) => t.subject.trim().length === 0 || t.body.trim().length === 0,
    );
    if (blank) {
      setLaunch({
        status: "error",
        message: `Email ${blank.touchNumber} needs a subject and a message before you can send.`,
      });
      return;
    }
    if (emailTouches.length === 0) {
      setLaunch({ status: "error", message: "No emails to send." });
      return;
    }

    setLaunch({ status: "sending", message: null });
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Every email touch ships together — each maps to its Sequence step by touchNumber.
        body: JSON.stringify({
          practiceId,
          touches: emailTouches.map((t) => ({
            touchNumber: t.touchNumber,
            subject: t.subject,
            body: t.body,
          })),
          cta: voice.sequence.namedCta,
        }),
      });
      const data: {
        error?: string;
        sentBy?: string;
        sentAt?: string;
        alreadySent?: boolean;
      } = await res.json().catch(() => ({}));
      if (res.ok) {
        setLaunch({ status: "sent", message: sentSummary(data.sentBy, data.sentAt) });
      } else if (data.alreadySent) {
        // Another AE claimed or sent this lead first (shared workspace). Not an error
        // the sender can fix — the outreach already went out — so LOCK the button with
        // the honest "already sent by X" message instead of a red failure. Keyed on the
        // server's `alreadySent` flag, NOT the bare 409 (a no-connection 409 must stay a
        // retryable error, not a false "Sent").
        setLaunch({
          status: "sent",
          message: data.error ?? "This lead has already been sent.",
        });
      } else {
        setLaunch({ status: "error", message: data.error ?? "Launch failed." });
      }
    } catch {
      setLaunch({ status: "error", message: "Launch failed. Couldn't reach the server." });
    }
  }

  return (
    <div className="flex flex-col gap-6">
        {/* The email sequence runs FULL width — who-to-contact moved to the header (Lilly). */}
        <Card variant="elevated" padding="lg">
          <div className="flex flex-col gap-6">
            {/* Title + description grouped TIGHT; a larger gap sits before the cards so the
                description reads with the header, not the first card (Lilly, 2026-07-10). */}
            <div className="flex flex-col gap-2">
              <SectionHeader
                title="Send email outreach sequence"
                size="h3"
                as="h2"
              />
              <p className="font-sans text-sm text-ink-body">
                {touches.length > 1 ? (
                  <>
                    One <span className="font-book text-ink">Send</span> ships all{" "}
                    {touches.length} emails as a sequence. The first goes out now, and the
                    follow-ups send automatically on the schedule shown on each. Edit every
                    email the way you want it before you send.
                  </>
                ) : (
                  <>
                    Edit your email, then hit{" "}
                    <span className="font-book text-ink">Send</span>.
                  </>
                )}
              </p>
            </div>
            <div className="flex flex-col gap-3">
              {touches.map((touch, i) => (
                <TouchEditor
                  key={touch.touchNumber}
                  touch={touch}
                  step={
                    SEQUENCE_STEP[touch.touchNumber] ?? {
                      role: `Email ${touch.touchNumber}`,
                      timing: "",
                    }
                  }
                  onChange={(patch) => updateTouch(touch.touchNumber, patch)}
                  spotlight={i === 0}
                />
              ))}
            </div>

            {/* ONE launch for the whole cadence — connected → the live enroll that
                ships every touch's edited copy; not connected → the named RevOps
                handoff. Never both. */}
            {hasEmail ? (
              sendConnected ? (
                <div className="flex flex-col gap-2">
                  <Button
                    variant="primary"
                    size="md"
                    onClick={handleLaunch}
                    // Disable while launching AND after success — one enrollment per
                    // click, never a duplicate. An error re-enables it for a retry.
                    disabled={launch.status === "sending" || launch.status === "sent"}
                  >
                    {launchLabelFor(launch.status)}
                  </Button>
                  {/* Launch status — the honest outcome, D9-safe (no address). */}
                  {launch.message ? (
                    <p
                      role="status"
                      aria-live="polite"
                      className={`font-sans text-sm ${
                        launch.status === "error" ? "text-danger" : "text-ink-body"
                      }`}
                    >
                      {launch.message}
                    </p>
                  ) : null}
                </div>
              ) : (
                <SendGate ctaLabel="Send sequence" />
              )
            ) : (
              <p className="font-sans text-sm text-ink-muted">
                No contact email on this brief yet, so there is nothing to send.
              </p>
            )}
          </div>
        </Card>

      {/* One-tap lead-quality vote — teaches the tool (tour step 5, `rate-lead`). */}
      <LeadFeedback practiceId={practiceId} />
    </div>
  );
}

/** 📋 Call-prep mode — everything to sound like a veteran once they pick up. */
function PrepMode({ brief, nowMs }: { brief: RenderedBrief; nowMs: number }) {
  const { factual, voice, live } = brief;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Call opener — moved here from the Send-email tab (Lilly, 2026-07-10): call
          content belongs with call prep, not the email sequence. */}
      <Card variant="elevated" padding="lg" className="lg:col-span-2">
        <div className="flex flex-col gap-3">
          <SectionHeader
            title="Call opener"
            description="What to say in the first ten seconds. Their world first."
            size="h3"
            as="h3"
          />
          <p className="rounded-panel bg-brand-50 p-4 font-sans text-base text-ink">
            {voice.callOpener}
          </p>
        </div>
      </Card>

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
      <IncumbentToolingPanel tooling={factual.incumbentTooling} />

      {/* EliseAI fit + proof + ROI — the tour's `why-fits` spotlights the header + pain. */}
      <Card variant="elevated" padding="lg" className="lg:col-span-2">
        <div className="flex flex-col gap-6">
          <div data-tour="why-fits" className="flex flex-col gap-6">
            <SectionHeader title="Why EliseAI fits" size="h3" as="h3" />
            <p className="max-w-3xl font-sans text-base text-ink-body">{factual.painFit}</p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Proof point */}
            <ProofPointPanel proofPoint={factual.proofPoint} />

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
        <div data-tour="discovery" className="flex flex-col gap-5">
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

type FactualBrief = RenderedBrief["factual"];

/** Proof-point card. Exported for render tests (E2E-02). */
export function ProofPointPanel({ proofPoint }: { proofPoint: FactualBrief["proofPoint"] }) {
  return (
    <div className="flex flex-col gap-3 rounded-panel bg-surface-subtle p-5">
      <div className="flex items-center gap-2">
        <span className="font-sans text-sm text-ink-muted">Proof point</span>
        {/* D10: "Measured" only over a real metric; a pending proof carries "Pending", */}
        {/* never a measurement badge over an absence (E2E-02). */}
        <Badge tone="neutral" size="sm">
          {proofPoint.tag === "real" ? "Measured" : "Pending"}
        </Badge>
      </div>
      {proofPoint.tag === "real" ? (
        <>
          <p className="font-display text-h5 text-ink">{proofPoint.caseStudy}</p>
          <ul className="flex flex-col gap-1.5">
            {proofPoint.metrics.map((m) => (
              <li key={m} className="font-sans text-sm text-ink-body">
                {m}
              </li>
            ))}
          </ul>
          <SourceLink href={proofPoint.href} className="w-fit text-sm">
            Read the customer story
          </SourceLink>
        </>
      ) : (
        <p className="font-sans text-sm text-ink-muted">
          Proof pending. No customer-success metric found for this vertical yet.
        </p>
      )}
    </div>
  );
}

/** Incumbent-tooling card. Exported for render tests (E2E-03). */
export function IncumbentToolingPanel({ tooling }: { tooling: FactualBrief["incumbentTooling"] }) {
  return (
    <Card variant="elevated" padding="lg">
      <div data-tour="incumbent-tooling" className="flex flex-col gap-5">
        <SectionHeader title="Incumbent tooling" size="h3" as="h3" />
        <div className="flex flex-col gap-4">
          {tooling.length > 0 ? (
            tooling.map((c) => <ClaimRow key={c.label} {...c} />)
          ) : (
            // E2E-03: an honest empty state, not a bare heading over blank space.
            <p className="font-sans text-sm text-ink-muted">
              No incumbent front-desk, phone, or scheduling tool identified yet.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

export function BriefView({
  brief,
  nowMs,
  practiceId,
  sendConnected,
  sentState,
}: {
  brief: RenderedBrief;
  nowMs: number;
  practiceId: string;
  sendConnected: boolean;
  sentState?: SentStateProp | null;
}) {
  const [mode, setMode] = useState<BriefMode>("outreach");
  const { factual } = brief;
  const location = [factual.city, factual.state].filter(Boolean).join(", ");

  // The guided tour flips the brief to the tier that holds the step it's coaching
  // (the call-prep sections live in prep; the editable email + thumb live in outreach).
  // A one-way event keeps the tour decoupled from this component's internals.
  useEffect(() => {
    function onMode(e: Event) {
      const detail = (e as CustomEvent<string>).detail;
      if (detail === "outreach" || detail === "prep") setMode(detail);
    }
    window.addEventListener("bme:brief-mode", onMode);
    return () => window.removeEventListener("bme:brief-mode", onMode);
  }, []);

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
        {/* Clean headline hero — the buying-moment headline OWNS the header (D1 spine);
            who-to-contact runs as a full-width strip below it (Lilly, 2026-07-10). */}
        <div className="flex flex-col gap-6 rounded-card border border-white/25 bg-white/5 p-5 backdrop-blur-sm sm:p-8">
          {/* Reading order — 1 practice name, 2 the buying-moment line, 3 the action
              toggle. On a phone they run straight down in that order (the action
              last, beneath the header words). On desktop the name + toggle share the
              top row (sm:order) and the headline wraps full-width below — the
              verified-live layout. One flat flex container reorders via `order`, so
              the data-tour hooks stay single. */}
          <div
            data-tour="why-now"
            className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-3 sm:gap-y-4"
          >
            {/* 1 · practice name on its own line, the location beneath it (line 2),
                a step quieter so the name leads. */}
            <div className="flex flex-col gap-0.5 sm:order-1">
              <span className="font-sans text-base font-medium uppercase tracking-eyebrow text-white">
                {factual.practiceName}
              </span>
              {location ? (
                <span className="font-sans text-sm font-medium uppercase tracking-eyebrow text-white/70">
                  {location}
                </span>
              ) : null}
            </div>

            {/* The buying-moment spine (D1). text-h4 on a phone so a long headline
                sits at a fitting size instead of towering over the hero; text-h2 is
                the verified-live desktop size. `sm:w-full` drops it to its own line
                below the name/toggle row on desktop. */}
            <h1 className="max-w-3xl font-display text-h4 font-book tracking-brand text-balance text-white sm:order-3 sm:w-full sm:text-h2">
              {brief.headline}
            </h1>

            <div data-tour="prep-toggle" className="w-full shrink-0 sm:order-2 sm:w-auto">
              <SegmentedControl<BriefMode>
                label="Choose what to work on this brief"
                options={MODE_OPTIONS}
                value={mode}
                onValueChange={setMode}
                accent="brand"
                fill
              />
            </div>
          </div>
        </div>
      </PageContainer>

      <main className="flex flex-1 flex-col">
        <PageContainer className="flex flex-col gap-6 pb-12 pt-6">
          {/* Who to contact — full-width strip below the hero, shown in both modes. */}
          <WhoToContact contact={factual.contact} />
          {mode === "outreach" ? (
            <OutreachMode
              brief={brief}
              practiceId={practiceId}
              sendConnected={sendConnected}
              sentState={sentState}
            />
          ) : (
            <PrepMode brief={brief} nowMs={nowMs} />
          )}
        </PageContainer>
      </main>
    </div>
  );
}
