import { cn } from "@/design/lib/cn";
import { signalGradients, type SignalKind } from "@/design/tokens";

/**
 * SignalPill (U2 / R15) — one pill per fired signal, colour-coded by kind.
 *
 * Shared by U8's feed row and U9's brief card, and by U8's signal filter, so the
 * colour an AE learns in the feed is the same colour they see everywhere.
 *
 * Shape is EliseAI's `.tag`: fully rounded, `px-5 py-2`, 6px inner gap, Inter.
 * The FILL is ours — a saturated gradient with white text, following their grammar
 * (94deg, saturated, never a pastel wash). See `signalGradients` in tokens.ts for
 * the honest provenance note.
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

export interface SignalPillProps {
  kind: SignalKind;
  className?: string;
}

/**
 * Deliberately no `muted`/`faded` variant. Dimming a pill with opacity produces the
 * pastel wash EliseAI never uses — their fills are saturated or near-black, full
 * stop. A stale lead is signalled by the `FreshnessClock` turning amber, not by
 * bleaching its signals.
 */
export function SignalPill({ kind, className }: SignalPillProps) {
  return (
    <span
      className={cn(
        // `w-fit` — a chip in a flex column would otherwise stretch. See tag.tsx.
        // Sized one step down from `Tag` (px-4/py-1.5/text-xs vs px-5/py-2/text-sm):
        // a signal is a qualifier on the practice, not a peer of it.
        "inline-flex w-fit items-center gap-1.5 rounded-pill px-4 py-1.5",
        "font-sans text-xs leading-none text-white",
        className,
      )}
      // Inline, not a Tailwind class: the gradient is a data-driven token, and
      // Tailwind only emits classes it can literally read in the source.
      style={{ backgroundImage: signalGradients[kind] }}
    >
      {LABELS[kind]}
    </span>
  );
}

export { type SignalKind };
export const SIGNAL_LABELS = LABELS;
