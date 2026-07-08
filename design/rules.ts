/**
 * design/rules.ts — the house rules (U2 / R15).
 *
 * These are not style preferences. Each one was earned by shipping the mistake it
 * forbids, during the U2 build, and being corrected. They are the difference between
 * "uses the design tokens" and "looks like EliseAI built it."
 *
 * This module is the SINGLE SOURCE: `/styleguide` renders it, and the kit's barrel
 * (`design/components/index.ts`) points here. Do not restate a rule in prose
 * somewhere else — that is how a rule quietly stops being true.
 *
 * A dev agent building U8, U9, or U12 should read this before writing a screen.
 */

export type RuleScope = "colour" | "content" | "hierarchy" | "layout" | "code";

export interface DesignRule {
  scope: RuleScope;
  /** The rule, imperative. */
  rule: string;
  /** Why it exists — usually the exact mistake it prevents. */
  why: string;
}

export const DESIGN_RULES: readonly DesignRule[] = [
  // -- colour ---------------------------------------------------------------
  {
    scope: "colour",
    rule: "Colour encodes; it never decorates.",
    why: "The product has exactly one colour vocabulary: the three signal kinds, each with its own gradient. An AE learns it in the feed and recognises it in the brief. Anything else on a row is ink.",
  },
  {
    scope: "colour",
    rule: "Fills are saturated or near-black. Never a pastel wash.",
    why: "EliseAI's own pill is a flat #f5f5f7 or a #0e0d0c. A tinted `bg-*-surface` chip with matching ink is not their language — it reads as a template default.",
  },
  {
    scope: "colour",
    rule: "Never dim a fill with opacity.",
    why: "Opacity over a light surface IS a pastel. A stale lead is marked by its clock turning red, not by bleaching its signals. This is why SignalPill has no `muted` variant.",
  },
  {
    scope: "colour",
    rule: "A gradient is one angle, two stops, offset ~30% / 73% — never 0% / 100%.",
    why: "Their `brandSoft` is `linear-gradient(75deg, #c1b8ff 30%, #649dfb 73%)`. Stops at the ends spread the ramp across the whole element, so on something as small as a pill every pixel differs slightly and the eye resolves it as one flat colour. Offset stops hold each end at its true colour and concentrate the transition where it can be seen. Both stops also need real lightness travel — #146ef4 -> #0053ff reads flat wherever you put the stops.",
  },
  {
    scope: "colour",
    rule: "Beyond the signal vocabulary, colour marks an exception.",
    why: "A stale clock turns red; a healthy row stays colourless. Never colour a chip merely to tell it apart from its neighbour.",
  },

  // -- content --------------------------------------------------------------
  {
    scope: "content",
    rule: "Never state a fact twice.",
    why: "Three SignalPills already say 'three signals firing' — a count badge repeats them. A FreshnessClock already shows age — a freshness badge repeats it. 'Cedarline Dermatology Group' already names the vertical — a `Dermatology` tag repeats it.",
  },
  {
    scope: "content",
    rule: "Cut any line that does not change a decision.",
    why: "'Sample row · 4 locations' cost a line and returned nothing. Location belongs in the brief, where the AE is deciding how to open the call — not in the scan view, where they are deciding whom to call.",
  },
  {
    scope: "content",
    rule: "A pill means 'you can filter by this.' A badge carries a number or a state.",
    why: "If nothing filters on it, it is metadata: render it as quiet text. If a badge has no number and no state, it should not be a badge.",
  },

  // -- hierarchy ------------------------------------------------------------
  {
    scope: "hierarchy",
    rule: "The entity is the heading. Qualifiers sit beneath it, one size down.",
    why: "An AE scans a feed for WHO to call; the pills beneath the name say why. Signal pills are sized a step below Tag (12px / 6x16) because they qualify the practice rather than stand beside it.",
  },
  {
    scope: "hierarchy",
    rule: "The one action on a row or card takes the `primary` button.",
    why: "Filled purple, `.primary-btn`. `secondary` is for lower-priority controls next to it; `tertiary` is a text link. Never a bare text link where the row's action lives.",
  },

  // -- layout ---------------------------------------------------------------
  {
    scope: "layout",
    rule: "A repeated item is `Card variant=\"flat\"`.",
    why: "Their real card is a #fafafb fill, 12px radius, no border and no shadow — twenty stack calmly because a flat fill has no edge to compete with. `outlined`/`elevated` lift ONE thing above its neighbours; never a list.",
  },
  {
    scope: "layout",
    rule: "Content lives in a contained surface, generously padded.",
    why: "The feed sits inside a rounded, gradient-backed container padded 56px — the same inset EliseAI gives `.new-nav-fixed`. Loose rows on a bare page read as a wireframe.",
  },
  {
    scope: "layout",
    rule: "Page frame = PageContainer / PageSection. Density = gap-2 / gap-4 / gap-6 / gap-8.",
    why: "8/16/24/32px, measured off their page. `py-section` (120px) is their MARKETING rhythm and must never appear between feed rows.",
  },

  // -- code -----------------------------------------------------------------
  {
    scope: "code",
    rule: "Use the kit. If a screen needs something the kit lacks, add it to the kit.",
    why: "Do not one-off a control, a numeral treatment, or an arbitrary size (`text-[10px]`) into a page. A bespoke component in a page is how a design system dies.",
  },
  {
    scope: "code",
    rule: "Every chip carries `w-fit`.",
    why: "`inline-flex` sets a chip's inner layout, not its outer size. Inside a flex column the default `align-self: stretch` blows it out to the full column width. This bug shipped three separate times in U2 — on Tag, on Badge, and on SegmentedControl.",
  },
  {
    scope: "code",
    rule: "Never build a class name by interpolation, and never hardcode a hex.",
    why: "Tailwind emits only classes it can literally read in the source, so `rounded-${x}` generates no CSS. And a hardcoded hex bypasses the token parity test — which is exactly how Wave 1 shipped a tokens file that nothing imported.",
  },
  {
    scope: "code",
    rule: "Two utilities from the same property never both apply.",
    why: "`border-danger/30` on a `Card variant=\"outlined\"` (which already sets `border-line-soft`) resolves by stylesheet order, not by intent. Compose so only one wins.",
  },
  {
    scope: "code",
    rule: "A control in the styleguide must actually work.",
    why: "The feed's vertical filter really filters. A demo control that only looks interactive is a lie in the one document whose entire job is to be trusted.",
  },
] as const;

export const RULES_BY_SCOPE = (scope: RuleScope): DesignRule[] =>
  DESIGN_RULES.filter((r) => r.scope === scope);

export const RULE_SCOPES: readonly RuleScope[] = [
  "colour",
  "content",
  "hierarchy",
  "layout",
  "code",
];
