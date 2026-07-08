import type { ReactNode } from "react";
import { cn } from "@/design/lib/cn";

/**
 * Meter (U12) — a single ratio against its track. Dataviz's answer to "a single
 * ratio against a limit" is a meter, not a two-slice pie; the scoreboard uses it
 * for signal→meeting conversion and the per-vertical comparisons.
 *
 * The track is a lighter step of the same ramp (`surface-subtle`), so state reads
 * across the whole bar; the fill's rounded ends are the 4px data-end dataviz asks
 * for (rounded-pill at this height). Colour still ENCODES: a meter keyed to a signal
 * takes that signal's gradient (`gradient` prop) — the same colour the AE learned in
 * the feed — while a magnitude comparison stays ink. Never a colour picked just to
 * tell one bar from its neighbour (design/rules.ts).
 *
 * Text wears text tokens, never the fill colour — the label and value are ink; the
 * bar beside them carries identity.
 */

export type MeterTone = "ink" | "brand" | "health";

const TONE_FILL: Record<MeterTone, string> = {
  ink: "bg-ink",
  brand: "bg-brand",
  health: "bg-health",
};

export interface MeterProps {
  label: ReactNode;
  /** Right-aligned value at the label row, e.g. "38%" or "12 → 5". Pre-formatted. */
  valueLabel?: string;
  /** 0..1; clamped. */
  fraction: number;
  /** Solid fill for magnitude comparisons. Ignored when `gradient` is set. */
  tone?: MeterTone;
  /** A CSS gradient (e.g. a signalGradient) — use ONLY when the bar is keyed to a signal. */
  gradient?: string;
  caption?: ReactNode;
  className?: string;
}

export function Meter({
  label,
  valueLabel,
  fraction,
  tone = "ink",
  gradient,
  caption,
  className,
}: MeterProps) {
  const pct = Math.max(0, Math.min(fraction, 1)) * 100;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-sans text-base text-ink">{label}</span>
        {valueLabel ? (
          <span className="font-mono text-sm tabular-nums text-ink-strong">
            {valueLabel}
          </span>
        ) : null}
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-pill bg-surface-subtle">
        <div
          className={cn("h-full rounded-pill", gradient ? undefined : TONE_FILL[tone])}
          style={{ width: `${pct}%`, backgroundImage: gradient }}
        />
      </div>
      {caption ? (
        <p className="font-sans text-sm text-ink-muted">{caption}</p>
      ) : null}
    </div>
  );
}
