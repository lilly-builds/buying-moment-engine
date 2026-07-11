import { cn } from "@/design/lib/cn";

/**
 * SampleSignalPill (Adapt-It P4) — a buying-moment pill for a TENANT's free-form
 * signal, the sample-feed sibling of the kit's `SignalPill`.
 *
 * The kit `SignalPill` maps a fixed three-kind healthcare union to a fixed label
 * (`staffing-spike` -> "Staffing spike"). A tenant's `sampleFeed` signals are
 * free-form `{name, kind}` strings, so that component can't render them. This one
 * carries the tenant's own signal NAME and borrows one of the three promoted signal
 * gradients so it re-skins with the tenant brand exactly like the real pill does
 * (the `--gradient-signal-*` vars a `BrandProvider` override repaints).
 *
 * The gradient is chosen by a stable hash of the signal name, so the SAME signal
 * wears the SAME colour everywhere it appears — the feed row and the brief — the way
 * an AE learns a colour in the feed and recognises it in the brief (design/rules.ts:
 * "Colour encodes; it never decorates").
 *
 * Styling is copied verbatim from `SignalPill` (same radius, gap, sizes, white ink)
 * so a tenant row is visually indistinguishable from the EliseAI feed's rows. The
 * precedent for a sample signal wearing a signal gradient + a custom label is P3's
 * onboarding `BrandPreview`.
 */

const SIGNAL_GRADIENTS = [
  "gradient-signal-staffing-spike",
  "gradient-signal-phone-complaints",
  "gradient-signal-growth-events",
] as const;

/** A stable name -> 0..2 hash, so a signal keeps its colour across the app. */
function gradientForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return SIGNAL_GRADIENTS[hash % SIGNAL_GRADIENTS.length];
}

export type SampleSignalPillSize = "sm" | "md";

const SIZES: Record<SampleSignalPillSize, string> = {
  sm: "px-4 py-1.5 text-xs",
  md: "px-5 py-2 text-sm",
};

export interface SampleSignalPillProps {
  /** The tenant's signal name, e.g. "Fleet expansion announced". */
  name: string;
  size?: SampleSignalPillSize;
  className?: string;
}

export function SampleSignalPill({ name, size = "sm", className }: SampleSignalPillProps) {
  return (
    <span
      className={cn(
        // `w-fit` is load-bearing inside a flex column — see design/components/tag.tsx.
        "inline-flex w-fit items-center gap-1.5 rounded-pill font-sans leading-none text-white",
        SIZES[size],
        gradientForName(name),
        className,
      )}
    >
      {name}
    </span>
  );
}
