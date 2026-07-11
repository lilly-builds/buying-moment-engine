/**
 * The EliseAI component kit (U2 / R15).
 *
 * This barrel is the contract U8 (feed), U9 (brief card), and U12 (scoreboard)
 * compile against. Import from `@/design/components`, never from the individual
 * files — the file layout is free to change, this surface is not.
 *
 * Every component and its variants render on `/styleguide`.
 *
 * ---------------------------------------------------------------------------
 * RESTRAINT — read `design/rules.ts` BEFORE composing a screen.
 *
 * Having these components does not mean using all of them. Every rule in that file
 * was earned by shipping the mistake it forbids. `/styleguide` renders the rules,
 * and beside them a labelled "Don't: chip soup" example — because a row wearing
 * seven chips is the default an AI reaches for, and it is not what a designer ships.
 *
 * The rules live in exactly one place so they cannot rot. Do not restate them here.
 *
 * The two that break the build rather than merely the design:
 *   - Never add a `tailwind.config.ts`. This is Tailwind v4; the theme lives in
 *     `app/globals.css`, mirrored from `design/tokens.ts`.
 *   - Never build a class name by interpolation (`rounded-${x}` generates no CSS).
 * ---------------------------------------------------------------------------
 */

export { PageContainer, PageSection, DENSITY_GAPS } from "./layout";
export type {
  PageContainerProps,
  PageSectionProps,
  ContainerWidth,
  SectionRhythm,
} from "./layout";

export { Button, ButtonLink } from "./button";
export type {
  ButtonProps,
  ButtonLinkProps,
  ButtonVariant,
  ButtonSize,
} from "./button";

export { Card } from "./card";
export type { CardProps, CardVariant, CardPadding } from "./card";

export { Input, Textarea } from "./field";
export type { InputProps, TextareaProps } from "./field";

export { Badge } from "./badge";
export type { BadgeProps, BadgeTone, BadgeSize } from "./badge";

export { Tag } from "./tag";
export type { TagProps, TagTone } from "./tag";

export { SignalPill, SIGNAL_LABELS } from "./signal-pill";
export type { SignalPillProps, SignalKind } from "./signal-pill";

export { FreshnessClock } from "./freshness-clock";
export type { FreshnessClockProps } from "./freshness-clock";

export { SectionHeader } from "./section-header";
export type {
  SectionHeaderProps,
  SectionHeaderTone,
  SectionHeaderSize,
  SectionHeaderLevel,
} from "./section-header";

export { TopNav } from "./top-nav";
export type { TopNavProps, TopNavTone } from "./top-nav";

export { LogoMark } from "./logo-mark";
export type { LogoMarkProps } from "./logo-mark";

export { Reveal } from "./reveal";
export type { RevealProps } from "./reveal";

export { SegmentedControl } from "./segmented-control";
export type { SegmentedControlProps, SegmentedOption } from "./segmented-control";

export { SourceLink } from "./source-link";
export type { SourceLinkProps } from "./source-link";

// -- U12 scoreboard figures: a number is a form, not a chart. ------------------
export { StatTile } from "./stat-tile";
export type { StatTileProps, StatHonesty, StatDelta } from "./stat-tile";

export { Meter } from "./meter";
export type { MeterProps, MeterTone } from "./meter";

export { StatRing } from "./stat-ring";
export type { StatRingProps, RingAccent } from "./stat-ring";
