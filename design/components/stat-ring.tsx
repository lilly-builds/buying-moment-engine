import type { ReactNode } from "react";
import { cn } from "@/design/lib/cn";

/**
 * StatRing (U12) — one headline ratio as a radial gauge. A single value against its
 * whole, nothing else: dataviz allows a radial for ONE number (never a pie comparing
 * categories), and it is the one "visual" flourish the minimal/sleek scoreboard
 * inspiration leans on. Use it at most once or twice per view — for a comparison,
 * reach for `Meter`.
 *
 * The track is a lighter step of the same surface; the arc carries the single accent.
 * The centre number is `font-display` (Inter Tight) — EliseAI's headline-stat face,
 * the same call as `StatTile`. Colour marks the value here, so brand/health/ink are
 * the only accents; no signal gradient (a ratio is not a signal identity).
 */

export type RingAccent = "brand" | "health" | "ink";

/**
 * The arc reads the accent as a CSS var, not a JS hex, so a per-tenant
 * BrandProvider override re-skins the ring (brand/health re-tint per workspace).
 */
const ACCENT_VAR: Record<RingAccent, string> = {
  brand: "var(--color-brand)",
  health: "var(--color-health)",
  ink: "var(--color-ink)",
};

export interface StatRingProps {
  /** 0..1; clamped. */
  fraction: number;
  /** Centre text — defaults to the rounded percentage. */
  centerLabel?: string;
  /** Small caption below the ring. */
  label?: ReactNode;
  accent?: RingAccent;
  /** Diameter in px. */
  size?: number;
  className?: string;
}

const R = 44;
const CIRC = 2 * Math.PI * R;

export function StatRing({
  fraction,
  centerLabel,
  label,
  accent = "brand",
  size = 148,
  className,
}: StatRingProps) {
  const f = Math.max(0, Math.min(fraction, 1));
  const center = centerLabel ?? `${Math.round(f * 100)}%`;

  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden="true">
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke="var(--color-surface-subtle)"
            strokeWidth="8"
          />
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke={ACCENT_VAR[accent]}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - f)}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-display text-h3 font-book tracking-brand text-ink">
            {center}
          </span>
        </div>
      </div>
      {label ? (
        <span className="text-center font-sans text-sm text-ink-muted">{label}</span>
      ) : null}
    </div>
  );
}
