import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/design/lib/cn";

/**
 * Card (U2 / R15).
 *
 * VERIFIED-LIVE from `.feature-card-opt1`: a FLAT `#fafafb` fill at radius 12px
 * with `overflow: hidden` — and no box-shadow. `tokens.draft.ts` paired cards
 * with `shadow-card` by default; the live site does not. Elevation is an explicit
 * opt-in here (`variant="elevated"`), which is what the brief card's expandable
 * tier-2 panel wants and what a plain feed row does not.
 */

export type CardVariant = "flat" | "elevated" | "outlined" | "dark" | "glass";
export type CardPadding = "none" | "sm" | "md" | "lg";

const VARIANTS: Record<CardVariant, string> = {
  flat: "bg-surface-card",
  elevated: "bg-surface shadow-card",
  outlined: "bg-surface border border-line-soft",
  // Dark section fill — `--new-dark-purple`. Pair with light-tone children.
  dark: "bg-surface-dark text-white",
  // Frosted glass — translucent white over a coloured surface (the /signals blue hero),
  // so the background shows through and the card reads as the same material as the glassy
  // discs. `backdrop-blur` frosts anything passing behind it. Use ONLY over a colour/image;
  // over plain white it is just a faint panel. Keep dark-tone children for legibility.
  glass: "bg-white/60 backdrop-blur-md border border-white/70",
};

// Phones tighten a step so content owns the narrow column instead of losing it to
// gutters (a `p-8` card on a 390px screen spends 64px on padding before any content).
// Desktop (sm:+) is unchanged — the verified-live padding.
const PADDING: Record<CardPadding, string> = {
  none: "",
  sm: "p-4",
  md: "p-5 sm:p-6",
  lg: "p-5 sm:p-8",
};

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "className"> {
  variant?: CardVariant;
  padding?: CardPadding;
  className?: string;
  children: ReactNode;
}

export function Card({
  variant = "flat",
  padding = "md",
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={cn(
        "rounded-card overflow-hidden",
        VARIANTS[variant],
        PADDING[padding],
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
