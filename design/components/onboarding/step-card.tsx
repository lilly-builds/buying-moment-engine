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
  /** An optional framed list (label + value per row) — the connect-overview beat. */
  bullets?: { label: string; text: string }[];
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
  /**
   * Render as a rounded FLOATING card instead of a bottom sheet (mobile only).
   * Used when the card is lifted off the bottom to sit above the nav bar it points
   * at, so a flat sheet edge doesn't hang in mid-air. Desktop is unaffected.
   */
  floating?: boolean;
  onNext: () => void;
  onSkip: () => void;
  className?: string;
}

export function StepCard({
  step,
  current,
  total,
  isLast = false,
  floating = false,
  onNext,
  onSkip,
  className,
}: StepCardProps) {
  return (
    <div
      role="dialog"
      aria-label="Getting started"
      className={cn(
        // A landscape rectangle, matching the reference card's proportions. Wide
        // enough that the longest step (the slide-1 welcome) wraps in few enough
        // lines to keep its Next/Skip controls on-screen.
        //
        // On a phone that floating card is a wall of text that buries the dashboard it
        // points at, so on mobile it becomes a BOTTOM SHEET: full-width, pinned to the
        // bottom in thumb reach, with tighter padding/gaps/orb/type (see below). The
        // read-me content scrolls only if the wordiest step overruns; the Skip/Next
        // footer stays pinned, so what you read and what you tap are always visible
        // without scrolling. Bottom padding clears the phone's home indicator, and
        // `sm:` restores the verified-live desktop card exactly.
        "flex w-full flex-col gap-3 bg-surface shadow-card sm:max-h-none sm:w-[40rem] sm:max-w-[calc(100vw-2rem)] sm:gap-4 sm:rounded-media sm:px-8 sm:py-7",
        // `floating` (lifted above the nav) is a rounded card; the default is the
        // bottom sheet flush to the screen edge, whose bottom padding clears the
        // home indicator and whose read-me region can scroll if a step runs long.
        floating
          ? "rounded-media px-5 py-6"
          : "max-h-[85dvh] rounded-t-media px-5 pt-6 pb-[max(1.25rem,env(safe-area-inset-bottom))]",
        className,
      )}
    >
      {/* The read-me content — a scrollable region on the mobile sheet; transparent
          (`display:contents`) at sm:+ so the desktop card lays out exactly as before,
          and on the compact floating card, whose short content needs no scroll. */}
      <div className={cn(floating ? "contents" : "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto sm:contents")}>
      {/* 1 · the gradient orb, holding this step's icon */}
      <span
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-pill text-white shadow-soft sm:h-14 sm:w-14"
        style={{ backgroundImage: gradients.orb }}
      >
        <StepIcon icon={step.icon} />
      </span>

      {/* 2 · the one-instruction line — the key part(s) bold + dark, the rest muted */}
      <p className="font-display text-lg leading-snug tracking-brand text-ink-muted text-balance sm:text-h5">
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
        <p className="font-sans text-sm leading-relaxed text-ink-body sm:text-base">
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

      {/* 2c · optional framed list — the connect-overview beat frames all three */}
      {step.bullets ? (
        <ul className="flex flex-col gap-2">
          {step.bullets.map((b, i) => (
            <li
              key={i}
              className="flex gap-2.5 font-sans text-sm leading-relaxed text-ink-body sm:text-base"
            >
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-pill bg-health" />
              <span>
                <span className="font-semibold text-ink">{b.label}:</span> {b.text}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* 3 · the ✦ context chip */}
      <span className="inline-flex w-fit items-center gap-1.5 rounded-pill border border-health-light px-4 py-1.5 font-sans text-sm text-health">
        <Sparkle />
        {step.chip}
      </span>
      </div>

      {/* progress + controls — a pinned footer on the mobile sheet, always visible */}
      <div className="mt-1 flex shrink-0 items-center justify-between">
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
