import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/design/lib/cn";

/**
 * Layout primitives (U2 / R15) — the page frame every screen sits in.
 *
 * Measured on eliseai.com/healthai at 1440px: content is a centered 1280px column
 * (`.container-large`), the minimum horizontal inset is 24px, and sections breathe
 * at 120px top/bottom (`.main-padding-section` — the dominant rhythm), with 64px
 * as the tightened variant.
 *
 * These exist so U8's feed, U9's brief card, and U12's scoreboard don't each
 * re-invent a max-width and a gutter and end up 8px apart from one another. The
 * frame is a token, not a habit.
 *
 * DENSITY, and this is the part worth reading: `PageSection`'s 120px rhythm is a
 * MARKETING rhythm — it's how EliseAI spaces a landing page. A feed of practice
 * rows must not use it. For content density use the measured gap scale, which is
 * plain Tailwind on the 4px base EliseAI already runs:
 *
 *   gap-2  (8px)   — inside a row: tag → tag, icon → label   [28 uses on their page]
 *   gap-4  (16px)  — between stacked rows, card grid gutters [14 uses]
 *   gap-6  (24px)  — between a card's internal blocks        [3 uses]
 *   gap-8  (32px)  — between distinct groups within a section [6 uses]
 *
 * So: `PageSection` for page chrome, the gap scale for everything inside it.
 */

export type ContainerWidth = "text" | "page" | "wide" | "full";

const WIDTHS: Record<ContainerWidth, string> = {
  text: "max-w-text", // 900px — prose, a single brief's body copy
  page: "max-w-page", // 1280px — the default content column
  wide: "max-w-wide", // 1600px — full-bleed max
  full: "",
};

export interface PageContainerProps
  extends Omit<HTMLAttributes<HTMLElement>, "className"> {
  width?: ContainerWidth;
  /** Drop the 24px horizontal inset — for a child that must bleed to the edge. */
  flush?: boolean;
  as?: ElementType;
  className?: string;
  children: ReactNode;
}

/** Centers content in the measured column and applies the 24px minimum gutter. */
export function PageContainer({
  width = "page",
  flush = false,
  as: Tag = "div",
  className,
  children,
  ...rest
}: PageContainerProps) {
  return (
    <Tag
      className={cn(
        "mx-auto w-full",
        WIDTHS[width],
        // 16px gutter on phones, the verified-live 24px from sm:+. Nav and content
        // both flow through here, so they stay on the same edge at every width.
        !flush && "px-4 sm:px-gutter",
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export type SectionRhythm = "section" | "tight" | "none";

const RHYTHM: Record<SectionRhythm, string> = {
  section: "py-section", // 120px — EliseAI's dominant marketing rhythm
  tight: "py-section-tight", // 64px — their tightened variant
  none: "",
};

export interface PageSectionProps {
  rhythm?: SectionRhythm;
  /** Paints a surface behind the full bleed while content stays in the column. */
  surface?: "none" | "card" | "canvas" | "subtle" | "dark";
  width?: ContainerWidth;
  as?: ElementType;
  className?: string;
  children: ReactNode;
}

const SURFACES: Record<NonNullable<PageSectionProps["surface"]>, string> = {
  none: "",
  card: "bg-surface-card",
  canvas: "bg-surface-canvas",
  subtle: "bg-surface-subtle",
  dark: "bg-surface-dark text-white",
};

/**
 * A full-bleed band that paints a surface edge-to-edge while keeping its content
 * inside the 1280px column — the shape every EliseAI section actually has.
 */
export function PageSection({
  rhythm = "section",
  surface = "none",
  width = "page",
  as: Tag = "section",
  className,
  children,
}: PageSectionProps) {
  return (
    <Tag className={cn("w-full", RHYTHM[rhythm], SURFACES[surface], className)}>
      <PageContainer width={width}>{children}</PageContainer>
    </Tag>
  );
}

/**
 * The measured content-density gaps, as a named scale. Exported so the styleguide
 * can render the evidence and so a reviewer can see the numbers rather than trust
 * a `gap-4` sprinkled through a diff.
 */
export const DENSITY_GAPS = [
  { cls: "gap-2", px: 8, uses: 28, use: "inside a row — tag → tag, icon → label" },
  { cls: "gap-4", px: 16, uses: 14, use: "stacked rows, card-grid gutters" },
  { cls: "gap-6", px: 24, uses: 3, use: "a card's internal blocks" },
  { cls: "gap-8", px: 32, uses: 6, use: "distinct groups within a section" },
] as const;
