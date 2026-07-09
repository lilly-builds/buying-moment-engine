import type { StepIconKey } from "@/src/onboarding/steps";

/**
 * StepIcon — the per-step glyph that sits inside the guided-step orb (U17).
 *
 * The ONE change from the reference card (`onboarding-flow-steps-ui-design.png`):
 * the orb holds a STEP icon, not the audio waveform. Each key maps to the
 * design's per-step table. Simple 24px line glyphs, `currentColor` stroke — the
 * orb sets the colour to white, so they read as the reference's white waveform did.
 */

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Each glyph draws inside a 24×24 box. */
const GLYPHS: Record<StepIconKey, React.ReactNode> = {
  // Ranked list — bars cooling down, hottest on top, with an up arrow. Evenly
  // spaced bars (4.5px steps) and a balanced arrow so it sits centred in the orb.
  rank: (
    <>
      <line x1="4" y1="7.5" x2="14" y2="7.5" {...STROKE} />
      <line x1="4" y1="12" x2="11" y2="12" {...STROKE} />
      <line x1="4" y1="16.5" x2="8" y2="16.5" {...STROKE} />
      <path d="M18.5 17.5V7.6" {...STROKE} />
      <path d="M15.9 10.2 18.5 7.4 21.1 10.2" {...STROKE} />
    </>
  ),
  // Tap — a click pointer with a small ripple.
  tap: (
    <>
      <path d="M9 4v8" {...STROKE} />
      <path d="M9 12V8.5a1.6 1.6 0 0 1 3.2 0V12" {...STROKE} />
      <path d="M12.2 11a1.5 1.5 0 0 1 3 0v1" {...STROKE} />
      <path d="M15.2 11.5a1.5 1.5 0 0 1 3 0v3.2a4.3 4.3 0 0 1-4.3 4.3h-1.8a4 4 0 0 1-3-1.4L8 15.5" {...STROKE} />
    </>
  ),
  // Spark / bolt — the buying moment firing now.
  spark: <path d="M13 3 5 13h5l-1 8 8-10h-5l1-8Z" {...STROKE} />,
  // Link — every claim links to its source ("see the proof").
  proof: (
    <>
      <path d="M9.5 13.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5l-1.2 1.2" {...STROKE} />
      <path d="M14.5 10.5a3.5 3.5 0 0 0-5 0L7 13a3.5 3.5 0 0 0 5 5l1.2-1.2" {...STROKE} />
    </>
  ),
  // Pencil — the email is written; edit anything.
  pencil: (
    <>
      <path d="M4 20h4l10-10-4-4L4 16v4Z" {...STROKE} />
      <path d="M13.5 6.5 17.5 10.5" {...STROKE} />
    </>
  ),
  // Thumbs-up — teach the tool a good lead.
  thumb: (
    <>
      <path d="M7 11v9H4v-9h3Z" {...STROKE} />
      <path d="M7 11l4-7a2 2 0 0 1 2.8 2.6L12.5 10H18a2 2 0 0 1 2 2.4l-1.2 5.6a2.5 2.5 0 0 1-2.4 2H7" {...STROKE} />
    </>
  ),
  // Call-prep sheet — everything you need to walk into the call confident.
  prep: (
    <>
      <rect x="5" y="4" width="14" height="16.5" rx="2" {...STROKE} />
      <line x1="8.5" y1="9" x2="15.5" y2="9" {...STROKE} />
      <line x1="8.5" y1="12.5" x2="15.5" y2="12.5" {...STROKE} />
      <line x1="8.5" y1="16" x2="12.5" y2="16" {...STROKE} />
    </>
  ),
  // Stacked layers — the prospect's current tech stack (incumbent tooling).
  tools: (
    <>
      <path d="M12 3.5 4 7.5l8 4 8-4-8-4Z" {...STROKE} />
      <path d="M4 12l8 4 8-4" {...STROKE} />
      <path d="M4 16.5l8 4 8-4" {...STROKE} />
    </>
  ),
  // Target — why the offer hits the mark (why EliseAI fits).
  fit: (
    <>
      <circle cx="12" cy="12" r="8.5" {...STROKE} />
      <circle cx="12" cy="12" r="4.5" {...STROKE} />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  // Speech bubble with a question — the discovery questions to ask on the call.
  ask: (
    <>
      <path
        d="M5 5.5h14a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-8l-3.5 3v-3H5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z"
        {...STROKE}
      />
      <path d="M10.2 8.9a1.8 1.8 0 1 1 2.4 1.7c-.55.24-.9.6-.9 1.2" {...STROKE} />
      <circle cx="11.7" cy="13.2" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  // Magnifier — look up any lead by name (pull mode).
  search: (
    <>
      <circle cx="11" cy="11" r="6" {...STROKE} />
      <line x1="15.5" y1="15.5" x2="20" y2="20" {...STROKE} />
    </>
  ),
  // Key — the one credential the RevOps owner turns to flip sending on.
  key: (
    <>
      <circle cx="8" cy="8" r="4" {...STROKE} />
      <path d="M11 11l8 8" {...STROKE} />
      <path d="M16 16l2-2M18.5 18.5l2-2" {...STROKE} />
    </>
  ),
};

export function StepIcon({ icon, className }: { icon: StepIconKey; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      role="presentation"
      aria-hidden="true"
      className={className}
      width="24"
      height="24"
    >
      {GLYPHS[icon]}
    </svg>
  );
}
