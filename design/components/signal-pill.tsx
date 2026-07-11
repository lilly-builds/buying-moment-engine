import { cn } from "@/design/lib/cn";
import { type SignalKind } from "@/design/tokens";

/**
 * SignalPill (U2 / R15) — one pill per fired signal, colour-coded by kind.
 *
 * Shared by U8's feed row and U9's brief card, and by U8's signal filter, so the
 * colour an AE learns in the feed is the same colour they see everywhere.
 *
 * Shape is EliseAI's `.tag`: fully rounded, `px-5 py-2`, 6px inner gap, Inter.
 * The FILL is ours — a saturated gradient with white text, following their grammar
 * (94deg, saturated, never a pastel wash). See the gradient tokens in tokens.ts
 * for the honest provenance note.
 *
 * Showing the signals *is* showing the count: three pills means three signals
 * firing (D8). A separate "3 signals" badge would state twice what the row already
 * says once.
 */

const LABELS: Record<SignalKind, string> = {
  "staffing-spike": "Staffing spike",
  "phone-complaints": "Phone complaints",
  "growth-events": "Growth event",
};

/**
 * The `.gradient-signal-<kind>` class per kind (defined in app/globals.css). A
 * static lookup, not `gradient-signal-${kind}` interpolation, because Tailwind
 * only emits classes it can literally read in the source — and because the class
 * reads the `--gradient-signal-<kind>` CSS var, so a per-tenant BrandProvider
 * override re-skins the pill with no change here.
 */
const KIND_GRADIENT: Record<SignalKind, string> = {
  "staffing-spike": "gradient-signal-staffing-spike",
  "phone-complaints": "gradient-signal-phone-complaints",
  "growth-events": "gradient-signal-growth-events",
};

export type SignalPillSize = "sm" | "md";

const SIZES: Record<SignalPillSize, string> = {
  // Default — a qualifier beneath the practice name in the feed.
  sm: "px-4 py-1.5 text-xs",
  // Bigger — where the signal is the subject, e.g. the brief's buying-moment rows.
  md: "px-5 py-2 text-sm",
};

export interface SignalPillProps {
  kind: SignalKind;
  size?: SignalPillSize;
  className?: string;
}

/**
 * Deliberately no `muted`/`faded` variant. Dimming a pill with opacity produces the
 * pastel wash EliseAI never uses — their fills are saturated or near-black, full
 * stop. A stale lead is signalled by the `FreshnessClock` turning amber, not by
 * bleaching its signals.
 */
export function SignalPill({ kind, size = "sm", className }: SignalPillProps) {
  return (
    <span
      className={cn(
        // `w-fit` — a chip in a flex column would otherwise stretch. See tag.tsx.
        // `sm` sits one step down from `Tag` (a signal qualifies the practice in the
        // feed); `md` matches `Tag` where the signal IS the subject (the brief).
        "inline-flex w-fit items-center gap-1.5 rounded-pill font-sans leading-none text-white",
        SIZES[size],
        KIND_GRADIENT[kind],
        className,
      )}
    >
      {LABELS[kind]}
    </span>
  );
}

export { type SignalKind };
export const SIGNAL_LABELS = LABELS;
