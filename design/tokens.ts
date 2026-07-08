/**
 * design/tokens.ts — EliseAI design tokens (U2 / R15)
 * ---------------------------------------------------------------------------
 * Ported from `wave1-research/tokens.draft.ts` and then CORRECTED against the
 * live site (2026-07-08, Chrome + `getComputedStyle` / real stylesheet rules).
 *
 * `themeVars` is the SINGLE SOURCE OF TRUTH. It is mirrored verbatim into the
 * `@theme` block in `app/globals.css` (this repo runs Tailwind v4, which
 * configures its theme in CSS, not in a `tailwind.config.ts`). A parity test —
 * `tests/design/tokens.test.ts` — fails if the two ever drift, in either
 * direction. That test exists because the draft's failure mode was exactly
 * this: a tokens object that nothing imported, so no class resolved to a brand
 * color.
 *
 * Provenance markers:
 *   VERIFIED-LIVE — read from `getComputedStyle` on eliseai.com (2026-07-08).
 *   VERIFIED-CSS  — read verbatim from `elise-ai-v3-…shared.min.css`.
 *   INFERRED      — a reasoned system built from verified values; no single
 *                   source token exists. Flagged for Lilly's brand sign-off.
 *
 * BRAND DIRECTION (resolved by evidence, not preference — see the four
 * corrections at the bottom of this file):
 *   Blue is the healthcare *surface*; purple is the *action* color.
 *   eliseai.com/healthai paints a blue hero and still renders its primary CTA
 *   in `#7638fa`. So: health-blue for the healthcare identity field (heroes,
 *   dark panels, vertical accents), brand-purple for every primary action.
 */

/**
 * The Tailwind v4 `@theme` contract. Every entry here MUST appear verbatim in
 * `app/globals.css`, and `app/globals.css` must declare no design token that is
 * absent here. Enforced by `tests/design/tokens.test.ts`.
 */
export const themeVars = {
  // --- Brand: purple — the ACTION color, on both the multifamily and
  // healthcare sides of the site. -------------------------------------------
  "--color-brand": "#7638fa", // VERIFIED-LIVE  primary button fill, both brands
  "--color-brand-50": "#f2f1ff", // VERIFIED-CSS   --extra-light-purple
  "--color-brand-100": "#ebedff", // VERIFIED-CSS   --purple-0
  "--color-brand-200": "#e8e7ff", // VERIFIED-CSS   --purple-2
  "--color-brand-300": "#c1b8ff", // VERIFIED-CSS   --purple-2025 (lavender)
  "--color-brand-400": "#ad88fc", // VERIFIED-CSS   --purple-3
  "--color-brand-500": "#8c6cff", // VERIFIED-CSS   --purple-btn-primary
  "--color-brand-600": "#7638fa", // VERIFIED-LIVE  --purple-5  PRIMARY
  "--color-brand-700": "#6032e6", // VERIFIED-CSS   --light-purple
  "--color-brand-800": "#5627ba", // VERIFIED-LIVE  --purple-6  PRIMARY :hover
  "--color-brand-900": "#472296", // VERIFIED-CSS   --purple-7
  "--color-brand-950": "#180b32", // VERIFIED-CSS   --purple-9

  // Secondary-button hover ink. VERIFIED-LIVE from `.button-secondary-default:hover`.
  "--color-brand-hover-ink": "#6b4fff",
  // Eyebrow/kicker purple, from the `.eyebrow` rule (not a :root var).
  "--color-eyebrow": "#704eff", // VERIFIED-CSS
  "--color-violet": "#7f4ae5", // VERIFIED-CSS   --blue-violet
  "--color-indigo": "#350da6", // VERIFIED-CSS   --deep-blue
  "--color-ink-purple": "#0f042d", // VERIFIED-CSS   --new-dark-purple (dark section bg)

  // --- Healthcare sub-brand: blue — the SURFACE / identity field ------------
  "--color-health": "#146ef4", // VERIFIED-CSS   --health-blue
  "--color-health-light": "#90baff", // VERIFIED-CSS   --health-blue-light
  "--color-health-pale": "#d2e4ff", // VERIFIED-CSS   --health-extra-light
  "--color-health-dark": "#011335", // VERIFIED-CSS   --health-dark-blue
  "--color-health-surface": "#e6eeff", // VERIFIED-CSS   --blue-0
  "--color-health-vivid": "#0053ff", // VERIFIED-CSS   --blue-5

  // --- Text / ink ------------------------------------------------------------
  "--color-ink": "#181819", // VERIFIED-LIVE  --dark-title (headline ink)
  "--color-ink-black": "#0e0d0c", // VERIFIED-CSS   --darker-title
  "--color-ink-strong": "#3a3a3b", // VERIFIED-CSS   --body-black
  "--color-ink-body": "#515152", // VERIFIED-CSS   --body-gray (default body)
  "--color-ink-muted": "#65707b", // VERIFIED-CSS   --gray-copy
  "--color-ink-subtle": "#737373", // VERIFIED-CSS   --light-grey-2
  "--color-ink-faint": "#999999", // VERIFIED-CSS   --light-grey (placeholder)
  "--color-ink-disabled": "#a0a9b2", // VERIFIED-CSS   --gray-disabled

  // --- Surfaces --------------------------------------------------------------
  "--color-surface": "#ffffff", // VERIFIED-CSS   --white
  "--color-surface-card": "#fafafb", // VERIFIED-LIVE  --new-bg-gray (.feature-card-opt1)
  "--color-surface-canvas": "#f7f8fa", // VERIFIED-CSS   --gray-bg
  "--color-surface-subtle": "#f5f5f7", // VERIFIED-LIVE  --bg-gray-gray (.tag fill)
  "--color-surface-warm": "#faf9f7", // VERIFIED-CSS   --brand-new-bg-gray
  "--color-surface-table": "#eff1f4", // VERIFIED-CSS   --table-gray
  "--color-surface-chip": "#efeeec", // VERIFIED-CSS   .dept-count fill
  "--color-surface-dark": "#0f042d", // VERIFIED-CSS   --new-dark-purple

  // --- Lines / borders -------------------------------------------------------
  "--color-line": "#e0e2e5", // VERIFIED-CSS   --gray-lines
  "--color-line-soft": "#eaeaed", // VERIFIED-CSS   --gray-lines-2
  "--color-line-cool": "#dedee1", // VERIFIED-CSS   --new-line-gray
  "--color-line-outline": "#dfdbff", // VERIFIED-LIVE  secondary-button border AT REST
  "--color-line-outline-hover": "#c1bafe", // VERIFIED-LIVE  secondary-button border ON HOVER

  // --- Semantic / status -----------------------------------------------------
  "--color-danger": "#e50501", // VERIFIED-CSS   --red-5
  "--color-success": "#bbebcd", // VERIFIED-CSS   --aquamarine (a FILL, not text)
  "--color-success-ink": "#12643a", // INFERRED       readable text on --color-success
  "--color-success-surface": "#f2fbf6", // VERIFIED-CSS   --mint-cream
  "--color-info": "#0053ff", // VERIFIED-CSS   --blue-5
  "--color-warn": "#b25a00", // INFERRED       no EliseAI warning token exists
  "--color-warn-surface": "#fff6ec", // INFERRED

  // --- Type ------------------------------------------------------------------
  // 450 is EliseAI's signature display weight. VERIFIED-LIVE on both heroes.
  // Named `book` (not `display`) because `--font-display` is the family token,
  // and Tailwind v4 would collide the two on the `font-*` utility namespace.
  "--font-weight-book": "450",

  // Sizes carry their own line-height/tracking, per Tailwind v4's `--text-*--*`
  // convention. Body sizes (xs…xl) intentionally left to Tailwind's defaults —
  // they already match EliseAI's 12/14/16/18/20.
  "--text-display": "4.5rem", // 72px  VERIFIED-LIVE (healthai hero)
  "--text-display--line-height": "1.05", // VERIFIED-LIVE (75.6px / 72px)
  "--text-display--letter-spacing": "-0.01em", // VERIFIED-CSS
  "--text-display--font-weight": "450", // VERIFIED-LIVE
  "--text-h1": "3.75rem", // 60px
  "--text-h1--line-height": "1.05",
  "--text-h1--letter-spacing": "-0.01em",
  "--text-h1--font-weight": "450",
  "--text-h2": "3rem", // 48px
  "--text-h2--line-height": "1.1",
  "--text-h2--letter-spacing": "-0.01em",
  "--text-h2--font-weight": "450",
  "--text-h3": "2.25rem", // 36px
  "--text-h3--line-height": "1.2",
  "--text-h3--font-weight": "450",
  "--text-h4": "1.875rem", // 30px  VERIFIED-CSS (h4 rule)
  "--text-h4--line-height": "1.4",
  "--text-h4--font-weight": "450",
  "--text-h5": "1.5rem", // 24px  VERIFIED-CSS (h5 rule)
  "--text-h5--line-height": "1.4",
  "--text-h5--font-weight": "450",

  "--tracking-brand": "-0.01em", // VERIFIED-CSS   headings
  "--tracking-control": "-0.16px", // VERIFIED-LIVE  .primary-btn
  "--tracking-eyebrow": "-0.18px", // VERIFIED-LIVE  hero eyebrow

  // --- Layout ----------------------------------------------------------------
  // Measured on eliseai.com/healthai at a 1440px viewport.
  //
  // Content is a centered 1280px column (`.container-large`), NOT edge-to-edge.
  // Sections breathe at 120px top/bottom (`.main-padding-section`, the dominant
  // rhythm — 4 of 11 sections; 64px is the tightened variant). The minimum
  // horizontal inset is 24px, taken from the hero section.
  //
  // NOTE, and it matters for U8/U9/U12: 120px is a MARKETING rhythm. A feed of
  // practices cannot breathe at 120px between rows. The dashboard density scale
  // is the gap scale, also measured live — 8px (28 uses) > 16px (14) > 32px (6) >
  // 24px (3). Those are just Tailwind's `gap-2 / gap-4 / gap-8 / gap-6` on the
  // 4px base EliseAI already uses; no token needed. Use `section` for page
  // chrome, the gap scale for content density.
  "--container-text": "900px", // VERIFIED-LIVE  hero prose column
  "--container-page": "1280px", // VERIFIED-LIVE  .container-large — the content column
  "--container-wide": "1600px", // VERIFIED-LIVE  .container — full-bleed max
  "--spacing-gutter": "24px", // VERIFIED-LIVE  minimum horizontal inset
  "--spacing-section": "120px", // VERIFIED-LIVE  dominant section rhythm
  "--spacing-section-tight": "64px", // VERIFIED-LIVE  tightened section rhythm

  // --- Radius ----------------------------------------------------------------
  // Semantic names on purpose. Overriding Tailwind's `rounded-sm|lg|xl` scale
  // would silently change what those utilities mean for anyone who writes them
  // out of habit; these names say what they're for instead.
  "--radius-control": "4px", // VERIFIED-LIVE  every .button-*-default
  "--radius-panel": "8px", // VERIFIED-CSS   default cards, image wrappers
  "--radius-card": "12px", // VERIFIED-LIVE  .feature-card-opt1
  "--radius-media": "24px", // VERIFIED-CSS   .datalog-card
  "--radius-pill": "999px", // VERIFIED-LIVE  .tag (50px), chips

  // --- Shadow ----------------------------------------------------------------
  // Soft, layered, low-alpha, tinted cool near-black (#181819) — never pure
  // black. Named to avoid clobbering Tailwind's `shadow-sm`.
  "--shadow-subtle": "0 1px 3px #0000000d, 0 10px 20px -10px #0000001a", // VERIFIED-CSS
  "--shadow-soft": "0 4px 8px -2px #1818191a, 0 2px 4px -2px #1818190f", // VERIFIED-CSS
  "--shadow-card": "0 12px 16px -6px #18181914, 0 4px 6px -4px #18181908", // VERIFIED-CSS
  "--shadow-ring": "0 0 1px #a9a8a6, 0 2px 4px #0000000a", // VERIFIED-CSS
} as const;

export type ThemeVar = keyof typeof themeVars;

/**
 * Gradients. Values VERIFIED-CSS. Placement now VERIFIED-LIVE: EliseAI paints
 * these as *hero backgrounds*, nowhere else.
 *
 * Caveat worth knowing: the /healthai hero is a raster (`Hero-Block.png`), not
 * a CSS gradient. `health-hero` below is our CSS approximation of it, built
 * from the confirmed health-blue ramp — it is INFERRED, and the one token most
 * worth eyeballing side-by-side. Kept out of `@theme` because Tailwind v4's
 * `--background-image-*` namespace would generate utilities we don't want to
 * encourage; import these explicitly where a hero needs one.
 */
export const gradients = {
  brand: "linear-gradient(94deg, #a093fd, #83c0ef 80%, #1a87f0)", // VERIFIED-CSS
  brandSoft: "linear-gradient(75deg, #c1b8ff 30%, #649dfb 73%)", // VERIFIED-CSS
  wash: "linear-gradient(146deg, #f2f1ff99, #e8f2ff99)", // VERIFIED-CSS (hero wash)
  healthHero: "linear-gradient(180deg, #4a86e8 0%, #6f9fee 55%, #c9d8f5 100%)", // INFERRED
} as const;

/**
 * Signal identity — one gradient per built signal kind (D3).
 *
 * DERIVED, not verified: EliseAI has no signal taxonomy, so no source rule exists.
 * These follow the STRUCTURE of their real gradients above, and nothing else:
 *
 *   `brandSoft` = linear-gradient(75deg, #c1b8ff 30%, #649dfb 73%)
 *                 -> ONE angle, TWO stops, and — the part that matters on a small
 *                    element — the stops are OFFSET (30% / 73%), not 0% / 100%.
 *
 * Offset stops are why theirs reads as a gradient and a naive one doesn't. With
 * stops at 0%/100% the ramp is spread across the whole element, so on something as
 * small as a pill every pixel is a slightly different colour and the eye resolves it
 * as one flat fill. Pinning the stops at 30% and 73% holds each end at its true
 * colour and concentrates the whole transition into the middle third, where it is
 * actually visible.
 *
 * So: two stops, one angle (94deg, from their `brand` gradient), offset 30%/73% (from
 * `brandSoft`). No three-stop multi-colour ramps — that is not a move EliseAI makes.
 * Every stop is a verified EliseAI token; only the pairing is ours.
 *
 * Each pair also needs real LIGHTNESS travel. Two adjacent shades (#146ef4 ->
 * #0053ff) read as a flat fill no matter where the stops sit.
 *
 *   staffing = purple           (purple-5   -> purple-btn-primary)
 *   phone    = blue             (blue-5     -> #1a87f0, a stop from `brand`)
 *   growth   = deep indigo      (deep-blue  -> blue-violet)
 */
export const signalGradients = {
  "staffing-spike": "linear-gradient(94deg, #7638fa 30%, #8c6cff 73%)",
  "phone-complaints": "linear-gradient(94deg, #0053ff 30%, #1a87f0 73%)",
  "growth-events": "linear-gradient(94deg, #350da6 30%, #7f4ae5 73%)",
} as const;

export type SignalKind = keyof typeof signalGradients;

/**
 * Grouped, human-readable view. Values are *referenced* from `themeVars`, never
 * re-typed, so this view cannot drift from the CSS theme. Use this when TS needs
 * a raw hex — chart series in U12, inline SVG fills. For everything else, use
 * the Tailwind classes.
 */
export const eliseTokens = {
  color: {
    brand: {
      DEFAULT: themeVars["--color-brand"],
      hover: themeVars["--color-brand-800"],
      lavender: themeVars["--color-brand-300"],
      wash: themeVars["--color-brand-50"],
    },
    health: {
      DEFAULT: themeVars["--color-health"],
      light: themeVars["--color-health-light"],
      pale: themeVars["--color-health-pale"],
      dark: themeVars["--color-health-dark"],
    },
    ink: {
      DEFAULT: themeVars["--color-ink"],
      body: themeVars["--color-ink-body"],
      muted: themeVars["--color-ink-muted"],
    },
    surface: {
      DEFAULT: themeVars["--color-surface"],
      card: themeVars["--color-surface-card"],
      canvas: themeVars["--color-surface-canvas"],
      dark: themeVars["--color-surface-dark"],
    },
    status: {
      danger: themeVars["--color-danger"],
      success: themeVars["--color-success"],
      info: themeVars["--color-info"],
      warn: themeVars["--color-warn"],
    },
  },
  layout: {
    text: themeVars["--container-text"],
    page: themeVars["--container-page"],
    wide: themeVars["--container-wide"],
    gutter: themeVars["--spacing-gutter"],
    section: themeVars["--spacing-section"],
    sectionTight: themeVars["--spacing-section-tight"],
  },
  gradients,
} as const;

export default eliseTokens;

/**
 * CORRECTIONS TO `tokens.draft.ts` — found by looking at the rendered site.
 * Each is a place the text-only extraction guessed wrong. Recorded, not deleted.
 *
 * 1. Button font-weight is 450, not 400. `.primary-btn` computes to `font-weight:
 *    450` on both heroes — the same "book" weight as the display face. The draft
 *    said 400.
 *
 * 2. The secondary-button border at REST is `#dfdbff` (--tertiary-button-outline);
 *    `#c1bafe` is the HOVER border. The draft used the hover value as the resting
 *    border, which would have shipped every outline button one step too dark.
 *
 * 3. Hero eyebrows are Inter (uppercase, tracking -0.18px), NOT IBM Plex Mono.
 *    Mono is real, but it's reserved for stat labels and count chips
 *    (`.dept-count`, `.stats-eyebrow`). We follow that split: `<Badge>` is mono
 *    (data), `<SectionHeader eyebrow>` is Inter (prose).
 *
 * 4. `.feature-card-opt1` carries NO box-shadow — it's a flat `#fafafb` fill with
 *    a 12px radius. The draft paired cards with `shadow-card` by default. Cards
 *    here default to flat; elevation is an explicit opt-in variant.
 *
 * 5. Section rhythm is 120px, not "48px/64px". The draft inferred the section
 *    padding from stray values in the stylesheet; measured on the rendered page,
 *    `.main-padding-section` is 120px top and bottom and is the most common
 *    section in the document, with 64px as the tightened variant. Content sits in
 *    a centered 1280px column, and the minimum horizontal inset is 24px.
 *
 * Also settled, so nobody has to re-ask:
 *   - Top-nav is transparent + `backdrop-filter: blur(25px)` + a 1px hairline
 *     that flips `rgba(0,0,0,.05)` on light / `rgba(255,255,255,.2)` on dark.
 *     It is NOT an opaque white bar, and NOT purple.
 *   - Primary :hover → `--purple-6 #5627ba`. Secondary :hover → ink `#6b4fff`,
 *     border `#c1bafe`.
 *   - "Diagramm" is not load-bearing: both heroes render Inter Tight 450. No
 *     substitution needed — Inter Tight *is* the hero face.
 *   - All three families (Inter Tight, Inter, IBM Plex Mono) are really loaded
 *     by the live site; `document.fonts` confirms it.
 *
 * STILL INFERRED — the honest list for Lilly's sign-off:
 *   - The segmented control. EliseAI has no such component; ours is built from
 *     the verified pill system.
 *   - `--color-warn` / `--color-warn-surface` / `--color-success-ink`: no
 *     EliseAI token exists. Chosen for contrast, not pulled.
 *   - `gradients.healthHero`: a CSS stand-in for a raster hero.
 *   - Section vertical rhythm (the 4px-base / 8px-step spacing scale).
 */
