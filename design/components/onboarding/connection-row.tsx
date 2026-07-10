import type { ReactNode } from "react";
import { gradients } from "@/design/tokens";
import { cn } from "@/design/lib/cn";
import { StepIcon } from "./step-icon";
import type { StepIconKey } from "@/src/onboarding/steps";
import type { ConnectionStatus } from "@/src/connect/connections";

/**
 * ConnectionRow — one row of the RevOps "Connections" checklist (Thread 08).
 *
 * Speaks the guided-step card LANGUAGE (onboarding-design §C) — a gradient orb
 * holding a step icon, a one-instruction line with the key word bold, and a ✦
 * context chip — plus a status pill (● Connected / ○ Not yet) and an optional
 * "Required to go live" marker. Then it renders its `children`: the real action
 * (the HubSpot Connect card, a paste-a-key card, the sequence sub-steps).
 *
 * Deliberately NOT a Card itself — the header sits on the page's health-hero
 * (light text), and the action Cards float below it, so nothing nests a white
 * card inside another white card. The shipped SequenceSetupCard slots in as a
 * child untouched (R8).
 */

/** The ✦ sparkle from the guided-step card, re-drawn here (StepCard's is private). */
function Sparkle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" className={className}>
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
        connected ? "bg-success-surface text-success-ink" : "bg-white/10 text-white/75",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-pill",
          connected ? "bg-success-ink" : "border border-white/50",
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
  chip: string;
  status: ConnectionStatus;
  /** Shows the "Required to go live" marker (HubSpot). */
  required?: boolean;
  children: ReactNode;
}

export function ConnectionRow({
  icon,
  line,
  chip,
  status,
  required = false,
  children,
}: ConnectionRowProps) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-4">
          <span
            className="flex size-12 shrink-0 items-center justify-center rounded-pill text-white shadow-soft"
            style={{ backgroundImage: gradients.orb }}
          >
            <StepIcon icon={icon} />
          </span>
          <div className="flex flex-col gap-2">
            <p className="font-display text-h5 leading-snug tracking-brand text-white/70">
              {line.map((seg, i) =>
                seg.bold ? (
                  <span key={i} className="font-semibold text-white">
                    {seg.text}
                  </span>
                ) : (
                  <span key={i}>{seg.text}</span>
                ),
              )}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex w-fit items-center gap-1.5 rounded-pill border border-white/25 px-3 py-1 font-sans text-sm text-white/85">
                <Sparkle className="text-health-light" />
                {chip}
              </span>
              {required ? (
                <span className="font-sans text-sm text-health-light">
                  Required to go live
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <StatusPill status={status} />
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}
