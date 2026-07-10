import { gradients } from "@/design/tokens";
import { cn } from "@/design/lib/cn";
import type { StepIconKey } from "@/src/onboarding/steps";
import { StepIcon } from "./step-icon";

/**
 * The presentational content the card draws — the orb icon, the one-instruction
 * line (two weights), an optional supporting sentence, and the ✦ chip. Both the AE
 * `OnboardingStep` and the RevOps tour step satisfy this, so one card renders both.
 */
export interface StepCardContent {
  icon: StepIconKey;
  line: { text: string; bold?: boolean }[];
  detail?: { text: string; em?: boolean; bold?: boolean }[];
  chip: string;
}

/**
 * StepCard — the guided-step card (U17).
 *
 * A faithful build of `onboarding-flow-steps-ui-design.png` + the design's
 * "guided-step card — UI direction", top → bottom:
 *   1. gradient ORB (purple→health-blue, `gradients.orb`) holding a STEP icon,
 *   2. one-instruction line, TWO weights — the single key word bold + dark ink,
 *      the rest muted slate (the reference's "…just a **reminder** that…"),
 *   3. a ✦ context chip — an outlined health-blue pill.
 * Then the controls the reference doesn't show but the design specifies: a row of
 * progress dots, a quiet "Next →", and a persistent "Skip".
 *
 * Pure presentation: it renders whatever `src/onboarding/steps.ts` hands it and
 * calls back on Next/Skip. The floating + spotlight behaviour lives in the tour
 * controller; this card just is the card.
 */

/** The ✦ sparkle from the reference chip — drawn so it renders identically everywhere. */
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

/** The Getting-started progress dots (● done/current · ○ upcoming). */
function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-label={`Step ${current} of ${total}`}>
      {Array.from({ length: total }, (_, i) => {
        const n = i + 1;
        const done = n <= current;
        return (
          <span
            key={n}
            className={cn(
              "h-1.5 rounded-pill transition-all duration-200",
              n === current ? "w-4 bg-brand" : done ? "w-1.5 bg-brand" : "w-1.5 bg-line",
            )}
          />
        );
      })}
    </div>
  );
}

export interface StepCardProps {
  step: StepCardContent;
  /** 1-based position of this step. */
  current: number;
  /** Total steps in the mini-mission. */
  total: number;
  /** The final step shows "Done ✓" instead of "Next →". */
  isLast?: boolean;
  onNext: () => void;
  onSkip: () => void;
  className?: string;
}

export function StepCard({
  step,
  current,
  total,
  isLast = false,
  onNext,
  onSkip,
  className,
}: StepCardProps) {
  return (
    <div
      role="dialog"
      aria-label="Getting started"
      className={cn(
        // A landscape rectangle, matching the reference card's proportions.
        "flex w-[32rem] max-w-[calc(100vw-2rem)] flex-col gap-4 rounded-media bg-surface px-8 py-7 shadow-card",
        className,
      )}
    >
      {/* 1 · the gradient orb, holding this step's icon */}
      <span
        className="flex h-14 w-14 items-center justify-center rounded-pill text-white shadow-soft"
        style={{ backgroundImage: gradients.orb }}
      >
        <StepIcon icon={step.icon} />
      </span>

      {/* 2 · the one-instruction line — the key part(s) bold + dark, the rest muted */}
      <p className="font-display text-h5 leading-snug tracking-brand text-ink-muted text-balance">
        {step.line.map((seg, i) =>
          seg.bold ? (
            <span key={i} className="font-semibold text-ink">
              {seg.text}
            </span>
          ) : (
            <span key={i}>{seg.text}</span>
          ),
        )}
      </p>

      {/* 2b · optional supporting sentence — makes the step's VALUE obvious */}
      {step.detail ? (
        <p className="font-sans text-base leading-relaxed text-ink-body">
          {step.detail.map((seg, i) =>
            seg.em ? (
              <em key={i}>{seg.text}</em>
            ) : seg.bold ? (
              <span key={i} className="font-semibold text-ink">
                {seg.text}
              </span>
            ) : (
              <span key={i}>{seg.text}</span>
            ),
          )}
        </p>
      ) : null}

      {/* 3 · the ✦ context chip */}
      <span className="inline-flex w-fit items-center gap-1.5 rounded-pill border border-health-light px-4 py-1.5 font-sans text-sm text-health">
        <Sparkle />
        {step.chip}
      </span>

      {/* progress + controls */}
      <div className="mt-1 flex items-center justify-between">
        <ProgressDots current={current} total={total} />
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onSkip}
            className="font-sans text-sm text-ink-faint transition-colors hover:text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={onNext}
            className="inline-flex items-center gap-1 font-sans text-sm font-book text-brand transition-colors hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            {isLast ? "Done" : "Next"}
            <span aria-hidden="true">{isLast ? "✓" : "→"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
