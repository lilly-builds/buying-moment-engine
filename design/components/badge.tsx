import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/design/lib/cn";

/**
 * Badge — the mono DATA chip (U2 / R15).
 *
 * Modelled on `.dept-count` / `.stats-eyebrow`: IBM Plex Mono, UPPERCASE, weight
 * 500, fully rounded, `#efeeec` fill. This is the right home for every number the
 * brief card states about itself:
 *   "3 SIGNALS FIRING" (D8 count) · freshness (D7) · per-signal confidence (D7)
 *   · the measured|modeled honesty tag (D10)
 *
 * Badge is mono because it carries data. `Tag` is Inter because it carries prose.
 * That split is EliseAI's, not ours — mono is reserved for stat labels on their
 * site; hero eyebrows render in Inter. See the corrections in `design/tokens.ts`.
 */

export type BadgeTone =
  | "neutral"
  | "brand"
  | "health"
  | "success"
  | "warn"
  | "danger";

export type BadgeSize = "sm" | "md";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-chip text-ink-strong",
  brand: "bg-brand text-white",
  health: "bg-health-surface text-health",
  success: "bg-success text-success-ink",
  warn: "bg-warn-surface text-warn",
  danger: "bg-danger text-white",
};

const SIZES: Record<BadgeSize, string> = {
  sm: "px-3 py-1 text-xs",
  md: "px-4 py-2 text-sm",
};

export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, "className"> {
  tone?: BadgeTone;
  size?: BadgeSize;
  className?: string;
  children: ReactNode;
}

export function Badge({
  tone = "neutral",
  size = "sm",
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={cn(
        // `w-fit`: see the note in tag.tsx — a chip inside a flex column would
        // otherwise stretch to the full column width.
        "inline-flex w-fit items-center gap-1.5 rounded-pill font-mono font-medium uppercase leading-none",
        TONES[tone],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
