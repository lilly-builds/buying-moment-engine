import type { ReactNode } from "react";
import { cn } from "@/design/lib/cn";
import { StepIcon } from "./step-icon";
import type { StepIconKey } from "@/src/onboarding/steps";
import type { ConnectionStatus } from "@/src/connect/connections";

/**
 * ConnectionRow — one row of the RevOps "Connections" checklist (Thread 08).
 *
 * It IS a guided-step card, the SAME white card the AE tour renders (see
 * `step-card.tsx` + the reference `onboarding-flow-steps-ui-design.png`): a
 * gradient orb holding a step icon, a one-instruction line with the key word bold
 * (dark on white, the rest muted slate), a ✦ context chip, and — added for setup —
 * a status pill (● Connected / ○ Not yet) and an optional "Required to go live"
 * marker. Below a hairline divider it renders its `children`: the real action
 * (connect button, paste-a-key form, sequence sub-steps), flattened so nothing
 * nests a card inside a card. This makes setup feel like the same product as the
 * AE onboarding.
 */

/** The ✦ sparkle from the guided-step card (StepCard's is module-private). */
function Sparkle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className={className}>
      <path
        d="M8 1.5c.5 2.9 1.6 4 4.5 4.5-2.9.5-4 1.6-4.5 4.5-.5-2.9-1.6-4-4.5-4.5C6.4 5.5 7.5 4.4 8 1.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

function StatusPill({ status }: { status: ConnectionStatus }) {
  const connected = status === "connected";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-pill px-3 py-1 font-sans text-sm",
        connected ? "bg-success-surface text-success-ink" : "bg-surface-subtle text-ink-muted",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-pill",
          connected ? "bg-success-ink" : "border border-line",
        )}
      />
      {connected ? "Connected" : "Not yet"}
    </span>
  );
}

export interface ConnectionRowProps {
  icon: StepIconKey;
  /** The one-instruction line, two weights — the bold segment is the key word. */
  line: { text: string; bold?: boolean }[];
  /** Optional supporting sentence under the instruction (like StepCard's detail). */
  detail?: string;
  chip: string;
  status: ConnectionStatus;
  /** Shows the "Required to go live" marker (HubSpot). */
  required?: boolean;
  /** `data-tour` hook so the RevOps coach-through can spotlight this whole row. */
  dataTour?: string;
  children: ReactNode;
}

export function ConnectionRow({
  icon,
  line,
  detail,
  chip,
  status,
  required = false,
  dataTour,
  children,
}: ConnectionRowProps) {
  return (
    // Same treatment as the AE StepCard: white surface, media radius, soft shadow.
    <div
      data-tour={dataTour}
      className="flex w-full flex-col gap-5 rounded-media bg-surface px-8 py-7 shadow-card"
    >
      <div className="flex items-start justify-between gap-4">
        <span className="gradient-orb flex size-14 shrink-0 items-center justify-center rounded-pill text-white shadow-soft">
          <StepIcon icon={icon} />
        </span>
        <StatusPill status={status} />
      </div>

      <div className="flex flex-col gap-3">
        <p className="font-display text-h5 leading-snug tracking-brand text-ink-muted text-balance">
          {line.map((seg, i) =>
            seg.bold ? (
              <span key={i} className="font-semibold text-ink">
                {seg.text}
              </span>
            ) : (
              <span key={i}>{seg.text}</span>
            ),
          )}
        </p>
        {detail ? (
          <p className="max-w-xl font-sans text-base leading-relaxed text-ink-body">
            {detail}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-pill border border-health-light px-4 py-1.5 font-sans text-sm text-health">
            <Sparkle />
            {chip}
          </span>
          {required ? (
            <span className="font-sans text-sm text-ink-faint">Required to go live</span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-5 border-t border-line-soft pt-5">{children}</div>
    </div>
  );
}
