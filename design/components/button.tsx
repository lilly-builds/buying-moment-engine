import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/design/lib/cn";

/**
 * Button (U2 / R15).
 *
 * Shape VERIFIED-LIVE from `.primary-btn` / `.button-*-default` on eliseai.com:
 *   radius 4px · Inter at the 450 "book" weight · tracking -0.16px · 10px gap
 *   md padding 12x24 (`.button-primary-default`) · sm padding 10x16 (nav variant)
 *   primary :hover -> --purple-6 #5627ba
 *   secondary rest border #dfdbff -> :hover border #c1bafe, ink #6b4fff
 *
 * `health` is the healthcare secondary (`.button-secondary-default-health`) — a
 * real EliseAI variant. Purple stays the primary action color even on the blue
 * healthcare pages, so `primary` is purple here too. That is not an oversight.
 */

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "health"
  | "tertiary"
  | "primary-dark";

export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex items-center justify-center gap-2.5 rounded-control font-sans " +
  "font-book tracking-control transition-colors duration-150 " +
  "disabled:cursor-not-allowed disabled:opacity-50 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand text-white hover:bg-brand-800",
  secondary:
    "bg-transparent text-brand border border-line-outline " +
    "hover:text-brand-hover-ink hover:border-line-outline-hover",
  health:
    "bg-transparent text-health border border-health " +
    "hover:bg-health-surface",
  tertiary: "bg-transparent text-brand hover:text-brand-800",
  // For dark/blue surfaces: flips to a white fill with dark ink.
  "primary-dark":
    "bg-white text-ink hover:bg-white/90 focus-visible:outline-white",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "px-4 py-2.5 text-base", // 16x10 — the nav variant
  md: "px-6 py-3 text-base", // 24x12 — the page variant
};

/** `tertiary` is a text link, so it drops horizontal padding at every size. Note
 *  this is a separate map rather than stripping `px-*` from SIZES: two competing
 *  `px-*` classes resolve by stylesheet order, not by order in the attribute, so
 *  "append px-0 and hope" is a real bug waiting to happen. */
const TERTIARY_SIZES: Record<ButtonSize, string> = {
  sm: "px-0 py-2.5 text-base",
  md: "px-0 py-3 text-base",
};

function buttonClasses(
  variant: ButtonVariant,
  size: ButtonSize,
  className?: string,
): string {
  const sizing =
    variant === "tertiary" ? TERTIARY_SIZES[size] : SIZES[size];
  return cn(BASE, VARIANTS[variant], sizing, className);
}

interface ButtonOwnProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}

export type ButtonProps = ButtonOwnProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">;

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button type={type} className={buttonClasses(variant, size, className)} {...rest}>
      {children}
    </button>
  );
}

export type ButtonLinkProps = ButtonOwnProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "children">;

/**
 * The same shape as `Button`, rendered as an anchor. U9's contact card needs real
 * anchors for the LinkedIn / Facebook mutual-connection deep-links — a `<button>`
 * with an onClick would break cmd-click, middle-click, and "copy link address".
 */
export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <a className={buttonClasses(variant, size, className)} {...rest}>
      {children}
    </a>
  );
}
