import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/design/lib/cn";

/**
 * Tag — the prose PILL (U2 / R15).
 *
 * VERIFIED-LIVE from `.tag`: fully rounded (50px), `#f5f5f7` fill, 6px inner gap,
 * Inter. The dark variant (`.demo-pill`) fills `#0e0d0c` with white text.
 *
 * Every lead carries a vertical tag and a signal-source tag (R1, locked in D6).
 * Those are this component. Numbers are `Badge`.
 */

export type TagTone = "default" | "brand" | "health" | "dark";

const TONES: Record<TagTone, string> = {
  default: "bg-surface-subtle text-ink-strong",
  brand: "bg-brand-50 text-brand-800",
  health: "bg-health-surface text-health",
  dark: "bg-ink-black text-white",
};

export interface TagProps extends Omit<HTMLAttributes<HTMLSpanElement>, "className"> {
  tone?: TagTone;
  /** A leading dot/icon slot — the 6px gap is already in the shape. */
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Tag({
  tone = "default",
  icon,
  className,
  children,
  ...rest
}: TagProps) {
  return (
    <span
      className={cn(
        // `w-fit` is load-bearing: inside a flex column the default `align-self:
        // stretch` would blow this pill out to the full column width, because
        // `inline-flex` only sets the inner layout, not the outer size.
        "inline-flex w-fit items-center gap-1.5 rounded-pill px-5 py-2 font-sans text-sm leading-none",
        TONES[tone],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </span>
  );
}
