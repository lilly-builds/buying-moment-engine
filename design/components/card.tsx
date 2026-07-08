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

export type CardVariant = "flat" | "elevated" | "outlined" | "dark";
export type CardPadding = "none" | "sm" | "md" | "lg";

const VARIANTS: Record<CardVariant, string> = {
  flat: "bg-surface-card",
  elevated: "bg-surface shadow-card",
  outlined: "bg-surface border border-line-soft",
  // Dark section fill — `--new-dark-purple`. Pair with light-tone children.
  dark: "bg-surface-dark text-white",
};

const PADDING: Record<CardPadding, string> = {
  none: "",
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
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
