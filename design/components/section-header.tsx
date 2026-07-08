import type { ReactNode } from "react";
import { cn } from "@/design/lib/cn";

/**
 * SectionHeader (U2 / R15) — eyebrow + title + optional description + action slot.
 *
 * The eyebrow is EliseAI's signature element above a section title. VERIFIED-LIVE:
 * on both heroes it renders in **Inter**, uppercase, tracking -0.18px — NOT in IBM
 * Plex Mono, which `tokens.draft.ts` assumed. Mono is reserved for data chips
 * (see `Badge`).
 *
 * Titles use Inter Tight at the 450 "book" weight with tight tracking — the
 * "big, thin, tight" headline that defines the look.
 */

export type SectionHeaderTone = "light" | "dark";
export type SectionHeaderSize = "display" | "h1" | "h2" | "h3" | "h4" | "h5";
export type SectionHeaderLevel = "h1" | "h2" | "h3" | "h4";

const SIZES: Record<SectionHeaderSize, string> = {
  display: "text-display",
  h1: "text-h1",
  h2: "text-h2",
  h3: "text-h3",
  h4: "text-h4",
  // h5 (24px) — a card-level title, e.g. the brief's "Who to contact". `text-h5`
  // is a real EliseAI token; card subheadings need it, and a plain <h*> with
  // `text-h5` scattered through pages is exactly the drift the kit prevents.
  h5: "text-h5",
};

export interface SectionHeaderProps {
  /** The uppercase kicker above the title. */
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Trailing controls — a filter, a "view all" link. */
  action?: ReactNode;
  /** `dark` inverts the ink for dark/blue surfaces. */
  tone?: SectionHeaderTone;
  /** Visual size. Independent of `as`, so semantics never fight the type scale. */
  size?: SectionHeaderSize;
  /** The heading element to render. Keeps the document outline correct even when
   *  a page's biggest headline is not an `<h1>`. */
  as?: SectionHeaderLevel;
  align?: "left" | "center";
  className?: string;
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  action,
  tone = "light",
  size = "h2",
  as: Heading = "h2",
  align = "left",
  className,
}: SectionHeaderProps) {
  const dark = tone === "dark";

  return (
    <div
      className={cn(
        "flex w-full gap-6",
        align === "center"
          ? "flex-col items-center text-center"
          : "flex-row items-end justify-between",
        className,
      )}
    >
      <div className={cn("flex flex-col gap-3", align === "center" && "items-center")}>
        {eyebrow ? (
          <span
            className={cn(
              "font-sans text-base font-medium uppercase tracking-eyebrow",
              dark ? "text-white" : "text-eyebrow",
            )}
          >
            {eyebrow}
          </span>
        ) : null}

        <Heading
          className={cn(
            "font-display font-book tracking-brand text-balance",
            SIZES[size],
            dark ? "text-white" : "text-ink",
          )}
        >
          {title}
        </Heading>

        {description ? (
          <p
            className={cn(
              "max-w-2xl font-sans text-lg text-pretty",
              dark ? "text-white/70" : "text-ink-body",
            )}
          >
            {description}
          </p>
        ) : null}
      </div>

      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
