import type { Metadata } from "next";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  DENSITY_GAPS,
  FreshnessClock,
  PageSection,
  SectionHeader,
  SignalPill,
  Tag,
  TopNav,
  type SignalKind,
} from "@/design/components";
import { gradients, signalGradients, themeVars, type ThemeVar } from "@/design/tokens";
import { RULES_BY_SCOPE, RULE_SCOPES } from "@/design/rules";
import { FeedDemo } from "./feed-demo";
import { SegmentedDemo } from "./segmented-demo";

export const metadata: Metadata = {
  title: "Styleguide · GTM Maestro",
};

/**
 * U2 verification surface (R15). Renders every token and every component variant
 * on one page so brand can be inspected — this is what Lilly signs off against,
 * side-by-side with eliseai.com.
 *
 * Swatches read straight from `design/tokens.ts`, so this page cannot drift from
 * the tokens: add a token and it appears here; the "Uncategorized" group below is
 * the tell-tale if someone adds one without placing it.
 */

// -- colour groups -----------------------------------------------------------
// Explicit and ordered, so `--color-ink-purple` (a dark purple section fill)
// doesn't get filed under "Ink" just because of its prefix.
const COLOR_GROUPS: ReadonlyArray<{ title: string; note: string; keys: ThemeVar[] }> = [
  {
    title: "Brand — purple",
    note: "The ACTION colour. Primary CTAs stay purple even on the blue healthcare pages. `brand` is the DEFAULT alias of `brand-600` — it's what `bg-brand` resolves to.",
    keys: [
      "--color-brand",
      "--color-brand-50",
      "--color-brand-100",
      "--color-brand-200",
      "--color-brand-300",
      "--color-brand-400",
      "--color-brand-500",
      "--color-brand-600",
      "--color-brand-700",
      "--color-brand-800",
      "--color-brand-900",
      "--color-brand-950",
    ],
  },
  {
    title: "Brand accents",
    note: "Eyebrow ink, hover ink, and the dark-section purple.",
    keys: [
      "--color-brand-hover-ink",
      "--color-eyebrow",
      "--color-violet",
      "--color-indigo",
      "--color-ink-purple",
    ],
  },
  {
    title: "Healthcare — blue",
    note: "The SURFACE / identity field. Heroes, dark panels, vertical accents.",
    keys: [
      "--color-health",
      "--color-health-light",
      "--color-health-pale",
      "--color-health-dark",
      "--color-health-surface",
      "--color-health-vivid",
    ],
  },
  {
    title: "Ink",
    note: "#181819 headings, #515152 body — never pure black.",
    keys: [
      "--color-ink",
      "--color-ink-black",
      "--color-ink-strong",
      "--color-ink-body",
      "--color-ink-muted",
      "--color-ink-subtle",
      "--color-ink-faint",
      "--color-ink-disabled",
    ],
  },
  {
    title: "Surface",
    keys: [
      "--color-surface",
      "--color-surface-card",
      "--color-surface-canvas",
      "--color-surface-subtle",
      "--color-surface-warm",
      "--color-surface-table",
      "--color-surface-chip",
      "--color-surface-dark",
    ],
    note: "Cards are a flat #fafafb fill — the live site gives them no shadow.",
  },
  {
    title: "Line",
    note: "#dfdbff is the outline button AT REST; #c1bafe is its hover.",
    keys: [
      "--color-line",
      "--color-line-soft",
      "--color-line-cool",
      "--color-line-outline",
      "--color-line-outline-hover",
    ],
  },
  {
    title: "Semantic",
    note: "warn + success-ink are INFERRED — EliseAI ships no token for either.",
    keys: [
      "--color-danger",
      "--color-success",
      "--color-success-ink",
      "--color-success-surface",
      "--color-info",
      "--color-warn",
      "--color-warn-surface",
    ],
  },
];

const CLAIMED = new Set<string>(COLOR_GROUPS.flatMap((g) => g.keys));
const UNCATEGORIZED = (Object.keys(themeVars) as ThemeVar[]).filter(
  (k) => k.startsWith("--color-") && !CLAIMED.has(k),
);

function Swatch({ name }: { name: ThemeVar }) {
  const hex = themeVars[name];
  return (
    <div className="flex min-w-[9.5rem] flex-col gap-2">
      {/* Inline style, not a Tailwind class: these names are data, and Tailwind
          can only see class names it can read in the source. */}
      <div
        className="h-14 w-full rounded-panel border border-line-soft"
        style={{ backgroundColor: hex }}
      />
      <div className="flex flex-col">
        <code className="font-mono text-xs text-ink-strong">
          {name.replace("--color-", "")}
        </code>
        <code className="font-mono text-xs uppercase text-ink-faint">{hex}</code>
      </div>
    </div>
  );
}

/**
 * Every section on this page is a real `PageSection` — so the styleguide is laid
 * out by the same system it documents, and the spacing you see here is the spacing
 * U8/U9/U12 will get. `tight` (64px) rather than `section` (120px): 120px is
 * EliseAI's marketing rhythm and a reference doc reads better dense. Both are
 * rendered to scale in "Spacing & layout" below.
 */
function Section({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <PageSection rhythm="tight" className="border-t border-line-soft">
      <div className="flex flex-col gap-8">
        <SectionHeader
          eyebrow={eyebrow}
          title={title}
          description={description}
          size="h3"
          as="h2"
        />
        {children}
      </div>
    </PageSection>
  );
}

/** A labelled ruler, so a spacing value is shown at true size rather than named. */
function Ruler({ token, label }: { token: ThemeVar; label: string }) {
  const value = themeVars[token];
  return (
    <div className="flex items-center gap-4">
      <div
        className="w-24 rounded-panel bg-brand-200"
        style={{ height: value }}
      />
      <div className="flex flex-col">
        <code className="font-mono text-xs text-ink-strong">{label}</code>
        <code className="font-mono text-xs text-ink-faint">{value}</code>
      </div>
    </div>
  );
}

const TYPE_SCALE: ReadonlyArray<{ cls: string; label: string; sample: string }> = [
  { cls: "text-display", label: "display · 72px / 450", sample: "Simplify Your Practice" },
  { cls: "text-h1", label: "h1 · 60px / 450", sample: "Prospects at a buying moment" },
  { cls: "text-h2", label: "h2 · 48px / 450", sample: "Proof in the Results" },
  { cls: "text-h3", label: "h3 · 36px / 450", sample: "Three signals firing" },
  { cls: "text-h4", label: "h4 · 30px / 450", sample: "Who to contact" },
  { cls: "text-h5", label: "h5 · 24px / 450", sample: "Call prep" },
];

// Written out in full, never interpolated: Tailwind generates utilities by
// scanning source text, so a `rounded-${r}` template literal produces no CSS.
const RADII: ReadonlyArray<{ token: ThemeVar; cls: string; name: string }> = [
  { token: "--radius-control", cls: "rounded-control", name: "control" },
  { token: "--radius-panel", cls: "rounded-panel", name: "panel" },
  { token: "--radius-card", cls: "rounded-card", name: "card" },
  { token: "--radius-media", cls: "rounded-media", name: "media" },
  { token: "--radius-pill", cls: "rounded-pill", name: "pill" },
];

const SHADOWS: ReadonlyArray<{ cls: string; name: string }> = [
  { cls: "shadow-subtle", name: "subtle" },
  { cls: "shadow-soft", name: "soft" },
  { cls: "shadow-card", name: "card" },
  { cls: "shadow-ring", name: "ring" },
];

export default function StyleguidePage() {
  return (
    <>
      <TopNav
        actions={
          <Badge tone="neutral" size="sm">
            U2 · R15
          </Badge>
        }
      />

      <main className="flex flex-1 flex-col">
        <PageSection rhythm="tight">
          <div className="flex flex-col gap-8">
            <SectionHeader
              eyebrow="Design system"
              title="EliseAI tokens & component kit"
              description="Every token and component U8, U9, and U12 compile against. Values were pulled from eliseai.com's live stylesheet, then corrected against the rendered site. Provenance for each one lives in design/tokens.ts."
              size="h1"
              as="h1"
            />

            {/* -- the brand call -------------------------------------------- */}
            <Card variant="outlined" padding="lg">
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge tone="brand">The brand call</Badge>
                  <Badge tone="neutral">Needs Lilly&apos;s sign-off</Badge>
                </div>
                <p className="max-w-text font-sans text-lg text-ink-body">
                  Blue is the healthcare <strong className="text-ink">surface</strong>; purple is the{" "}
                  <strong className="text-ink">action</strong> colour. This is not a preference —{" "}
                  <a
                    href="https://eliseai.com/healthai"
                    className="text-brand underline underline-offset-4 hover:text-brand-800"
                    target="_blank"
                    rel="noreferrer"
                  >
                    eliseai.com/healthai
                  </a>{" "}
                  paints a blue hero and still renders its primary CTA in{" "}
                  <code className="font-mono text-ink">#7638fa</code>. We follow that split exactly.
                </p>
              </div>
            </Card>
          </div>
        </PageSection>

        {/* -- the rules ----------------------------------------------------- */}
        <Section
          eyebrow="House rules"
          title="How to use this system"
          description="Not style preferences. Each rule was earned by shipping the mistake it forbids, then being corrected. They live in design/rules.ts — this page renders that module, so a rule cannot quietly stop being true. Read them before composing a screen."
        >
          <div className="flex flex-col gap-10">
            {RULE_SCOPES.map((scope) => (
              <div key={scope} className="flex flex-col gap-4">
                <Badge tone="neutral">{scope}</Badge>
                <ul className="flex flex-col gap-5">
                  {RULES_BY_SCOPE(scope).map((r) => (
                    <li key={r.rule} className="flex flex-col gap-1.5">
                      <p className="font-display text-h5 text-ink">{r.rule}</p>
                      <p className="max-w-text font-sans text-sm text-ink-muted">{r.why}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>

        {/* -- colour -------------------------------------------------------- */}
        <Section
          eyebrow="Colour"
          title="Palette"
          description="Every hex is a real EliseAI token, read from their stylesheet or the rendered page."
        >
          <div className="flex flex-col gap-10">
            {COLOR_GROUPS.map((group) => (
              <div key={group.title} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <h3 className="font-display text-h5 text-ink">{group.title}</h3>
                  {group.note ? (
                    <p className="font-sans text-sm text-ink-muted">{group.note}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-4">
                  {group.keys.map((k) => (
                    <Swatch key={k} name={k} />
                  ))}
                </div>
              </div>
            ))}

            {UNCATEGORIZED.length > 0 ? (
              <div className="flex flex-col gap-4">
                <h3 className="font-display text-h5 text-danger">
                  Uncategorized — place these in COLOR_GROUPS
                </h3>
                <div className="flex flex-wrap gap-4">
                  {UNCATEGORIZED.map((k) => (
                    <Swatch key={k} name={k} />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </Section>

        {/* -- gradients ------------------------------------------------------ */}
        <Section
          eyebrow="Colour"
          title="Gradients"
          description="Values verified from the stylesheet; placement verified live — EliseAI paints these as hero backgrounds, nowhere else. healthHero is our CSS stand-in for a raster hero, and is INFERRED."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(gradients).map(([name, value]) => (
              <div key={name} className="flex flex-col gap-2">
                <div
                  className="h-28 w-full rounded-card border border-line-soft"
                  style={{ backgroundImage: value }}
                />
                <code className="font-mono text-xs text-ink-strong">{name}</code>
              </div>
            ))}
          </div>
        </Section>

        {/* -- type ----------------------------------------------------------- */}
        <Section
          eyebrow="Typography"
          title="Type scale"
          description="Inter Tight at weight 450 with tight tracking — the 'big, thin, tight' headline is the single most distinctive thing about EliseAI's type."
        >
          <div className="flex flex-col gap-8">
            {TYPE_SCALE.map((t) => (
              <div key={t.cls} className="flex flex-col gap-2">
                <code className="font-mono text-xs uppercase text-ink-faint">{t.label}</code>
                <p className={`${t.cls} font-display text-ink text-balance`}>{t.sample}</p>
              </div>
            ))}

            <div className="grid gap-6 border-t border-line-soft pt-8 sm:grid-cols-3">
              <div className="flex flex-col gap-2">
                <code className="font-mono text-xs uppercase text-ink-faint">
                  Inter · body
                </code>
                <p className="font-sans text-lg text-ink-body">
                  The default body size is 18px — heavily used across their site.
                </p>
                <p className="font-sans text-base text-ink-body">16px base.</p>
                <p className="font-sans text-sm text-ink-muted">14px secondary.</p>
              </div>
              <div className="flex flex-col gap-2">
                <code className="font-mono text-xs uppercase text-ink-faint">
                  Inter · eyebrow
                </code>
                <span className="font-sans text-base font-medium uppercase tracking-eyebrow text-eyebrow">
                  AI for healthcare
                </span>
                <p className="font-sans text-sm text-ink-muted">
                  Hero eyebrows are Inter, not mono. The draft had this wrong.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <code className="font-mono text-xs uppercase text-ink-faint">
                  IBM Plex Mono · data
                </code>
                <span className="font-mono text-sm font-medium uppercase text-ink-strong">
                  3 signals firing
                </span>
                <p className="font-sans text-sm text-ink-muted">
                  Mono is reserved for stat labels and count chips.
                </p>
              </div>
            </div>
          </div>
        </Section>

        {/* -- radius + shadow ------------------------------------------------ */}
        <Section
          eyebrow="Form"
          title="Radius & elevation"
          description="Shadows are gentle and diffuse, tinted cool near-black rather than pure black. Named semantically so Tailwind's own rounded-sm / shadow-sm keep their meaning."
        >
          <div className="flex flex-col gap-10">
            <div className="flex flex-wrap gap-6">
              {RADII.map((r) => (
                <div key={r.name} className="flex flex-col items-center gap-2">
                  <div
                    className={`h-20 w-20 border border-line bg-surface-subtle ${r.cls}`}
                  />
                  <code className="font-mono text-xs text-ink-strong">{r.cls}</code>
                  <code className="font-mono text-xs text-ink-faint">
                    {themeVars[r.token]}
                  </code>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-8">
              {SHADOWS.map((s) => (
                <div key={s.name} className="flex flex-col items-center gap-3">
                  <div className={`h-20 w-32 rounded-card bg-surface ${s.cls}`} />
                  <code className="font-mono text-xs text-ink-strong">{s.cls}</code>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* -- spacing + layout ----------------------------------------------- */}
        <Section
          eyebrow="Layout"
          title="Spacing & layout"
          description="Measured on eliseai.com/healthai at a 1440px viewport. This is the frame the dashboard is assembled in — content column, section rhythm, gutter, and the content-density gap scale."
        >
          <div className="flex flex-col gap-12">
            {/* content column */}
            <div className="flex flex-col gap-4">
              <h3 className="font-display text-h5 text-ink">Content column</h3>
              <p className="max-w-text font-sans text-sm text-ink-muted">
                Content is a centered column, not edge-to-edge. Every bar below is the
                real utility, rendered at true width.
              </p>
              <div className="flex flex-col gap-2">
                {(
                  [
                    { cls: "max-w-text", token: "--container-text", use: "prose / a brief's body copy" },
                    { cls: "max-w-page", token: "--container-page", use: "the default content column" },
                    { cls: "max-w-wide", token: "--container-wide", use: "full-bleed max" },
                  ] as const
                ).map((c) => (
                  <div key={c.cls} className="flex flex-col gap-1">
                    <div
                      className={`h-8 rounded-panel bg-health-surface ${c.cls}`}
                    />
                    <div className="flex flex-wrap items-baseline gap-3">
                      <code className="font-mono text-xs text-ink-strong">{c.cls}</code>
                      <code className="font-mono text-xs text-ink-faint">
                        {themeVars[c.token as ThemeVar]}
                      </code>
                      <span className="font-sans text-xs text-ink-muted">{c.use}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* section rhythm */}
            <div className="flex flex-col gap-4">
              <h3 className="font-display text-h5 text-ink">Section rhythm</h3>
              <p className="max-w-text font-sans text-sm text-ink-muted">
                <code className="font-mono text-ink">py-section</code> is EliseAI&apos;s dominant
                rhythm — but it is a <strong className="text-ink">marketing</strong> rhythm. A feed
                of practice rows must not use it. Shown to scale:
              </p>
              <div className="flex flex-wrap gap-10">
                <Ruler token="--spacing-section" label="py-section (marketing)" />
                <Ruler token="--spacing-section-tight" label="py-section-tight" />
                <Ruler token="--spacing-gutter" label="px-gutter (min inset)" />
              </div>
            </div>

            {/* density gaps */}
            <div className="flex flex-col gap-4">
              <h3 className="font-display text-h5 text-ink">
                Content density — the gap scale
              </h3>
              <p className="max-w-text font-sans text-sm text-ink-muted">
                What the dashboard actually spaces with. Counts are real occurrences on
                their healthcare page, so this is the rhythm EliseAI reaches for, not one
                we picked.
              </p>
              <div className="flex flex-col gap-5">
                {DENSITY_GAPS.map((g) => (
                  <div key={g.cls} className="flex flex-wrap items-center gap-6">
                    <div className={`flex ${g.cls}`}>
                      {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="h-8 w-8 rounded-panel bg-brand-300" />
                      ))}
                    </div>
                    <code className="font-mono text-xs text-ink-strong">{g.cls}</code>
                    <code className="font-mono text-xs text-ink-faint">{g.px}px</code>
                    <Badge tone="neutral">{g.uses} uses</Badge>
                    <span className="font-sans text-sm text-ink-muted">{g.use}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Section>

        {/* -- buttons -------------------------------------------------------- */}
        <Section
          eyebrow="Components"
          title="Button"
          description="Radius 4px, Inter at the 450 book weight, tracking -0.16px. Primary hovers to #5627ba; the outline button's resting border is #dfdbff and darkens to #c1bafe on hover."
        >
          <div className="flex flex-col gap-8">
            <div className="flex flex-wrap items-center gap-4">
              <Button variant="primary">Request Demo</Button>
              <Button variant="secondary">Learn More</Button>
              <Button variant="health">Book a Demo</Button>
              <Button variant="tertiary">Read More</Button>
              <Button variant="primary" disabled>
                Disabled
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <Button variant="primary" size="sm">
                Small / nav
              </Button>
              <Button variant="secondary" size="sm">
                Small / nav
              </Button>
              <ButtonLink
                variant="secondary"
                size="sm"
                href="https://www.linkedin.com/"
                target="_blank"
                rel="noreferrer"
              >
                ButtonLink → real anchor
              </ButtonLink>
            </div>

            <Card variant="dark" padding="lg">
              <div className="flex flex-col gap-4">
                <p className="font-sans text-sm text-white/70">
                  On a dark surface, primary flips to a white fill with dark ink.
                </p>
                <div className="flex flex-wrap items-center gap-4">
                  <Button variant="primary-dark">Request Demo</Button>
                  <Button variant="primary">Still purple</Button>
                </div>
              </div>
            </Card>
          </div>
        </Section>

        {/* -- card ----------------------------------------------------------- */}
        <Section
          eyebrow="Components"
          title="Card"
          description="Flat by default — .feature-card-opt1 carries no box-shadow on the live site. Elevation is an explicit opt-in. `glass` is the odd one out: translucent, so it only reads over a colour/image (shown below on the health hero) — the /signals intro uses it over the blue."
        >
          <div className="flex flex-col gap-6">
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              {(["flat", "elevated", "outlined", "dark"] as const).map((v) => (
                <Card key={v} variant={v} padding="md">
                  <div className="flex flex-col gap-2">
                    <code className="font-mono text-xs uppercase opacity-60">{v}</code>
                    <p className="font-display text-h5">Georgia Dermatology</p>
                    <p className={v === "dark" ? "text-sm text-white/70" : "text-sm text-ink-muted"}>
                      Atlanta, GA · 4 locations
                    </p>
                  </div>
                </Card>
              ))}
            </div>

            {/* glass — translucent, so it must sit on a coloured surface to be seen. */}
            <div
              className="rounded-card p-8"
              style={{ backgroundImage: gradients.healthHero }}
            >
              <Card variant="glass" padding="md" className="max-w-xs">
                <div className="flex flex-col gap-2">
                  <code className="font-mono text-xs uppercase opacity-60">glass</code>
                  <p className="font-display text-h5 text-ink">Georgia Dermatology</p>
                  <p className="text-sm text-ink-muted">Atlanta, GA · 4 locations</p>
                </div>
              </Card>
            </div>
          </div>
        </Section>

        {/* -- badge + tag ---------------------------------------------------- */}
        <Section
          eyebrow="Components"
          title="Badge & Tag"
          description="Badge is mono because it carries data. Tag is Inter because it carries prose. That split is EliseAI's, not ours."
        >
          <div className="flex flex-col gap-10">
            <div className="flex flex-col gap-4">
              <h3 className="font-display text-h5 text-ink">Badge — the data chip</h3>
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone="brand">3 signals firing</Badge>
                <Badge tone="success">Fresh · 2 days</Badge>
                <Badge tone="warn">Stale · 34 days</Badge>
                <Badge tone="danger">Expired</Badge>
                <Badge tone="health">High confidence</Badge>
                <Badge tone="neutral">Measured</Badge>
                <Badge tone="neutral">Modeled</Badge>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone="brand" size="md">
                  3 signals firing
                </Badge>
                <Badge tone="neutral" size="md">
                  Measured
                </Badge>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <h3 className="font-display text-h5 text-ink">
                SignalPill — one saturated gradient per signal kind
              </h3>
              <p className="max-w-text font-sans text-sm text-ink-muted">
                DERIVED, not verified: EliseAI has no signal taxonomy. What carries over is
                the grammar — the 94deg angle of their real brand gradient, saturated fills
                with white text, never a pastel wash. Every stop is a verified EliseAI
                token; only the pairing is ours. Three pills = three signals firing, so the
                count needs no badge. There is deliberately no dimmed variant: a stale lead
                is marked by its clock turning amber, not by bleaching its signals.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {(Object.keys(signalGradients) as SignalKind[]).map((k) => (
                  <SignalPill key={k} kind={k} />
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <h3 className="font-display text-h5 text-ink">
                FreshnessClock — age as a dial
              </h3>
              <p className="max-w-text font-sans text-sm text-ink-muted">
                The hand sweeps across the <strong className="text-ink">7-day freshness
                window</strong>, so the dial reads as time remaining, not age in the
                abstract: near twelve = just fired, nearly round = about to expire. Past 7
                days it goes red. The threshold lives in the component, not at the call
                site — a caller that forgot to pass it would render an expired lead as
                fresh, which is exactly the failure D7 warns about.
              </p>
              <div className="flex flex-wrap items-center gap-6">
                {[1, 2, 4, 6, 7].map((d) => (
                  <FreshnessClock key={d} days={d} />
                ))}
                <FreshnessClock days={9} />
                <FreshnessClock days={34} />
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <h3 className="font-display text-h5 text-ink">Tag — the prose pill</h3>
              <p className="font-sans text-sm text-ink-muted">
                Every lead carries a vertical tag and a signal-source tag (R1).
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Tag tone="default">Dermatology</Tag>
                <Tag tone="brand">Women&apos;s Health</Tag>
                <Tag tone="health">Ophthalmology</Tag>
                <Tag tone="dark">Orthopedics</Tag>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Tag tone="default">Staffing spike</Tag>
                <Tag tone="default">Phone complaints</Tag>
                <Tag tone="default">Growth event</Tag>
              </div>
            </div>
          </div>
        </Section>

        {/* -- section header ------------------------------------------------- */}
        <Section
          eyebrow="Components"
          title="SectionHeader"
          description="Eyebrow + title + description + an action slot. Visual size and heading level are independent, so semantics never fight the type scale."
        >
          <div className="flex flex-col gap-12">
            <SectionHeader
              eyebrow="Buying moment"
              title="Front desk underwater"
              description="Three signals fired in the last 14 days."
              size="h3"
              as="h3"
              action={<Button variant="secondary" size="sm">View brief</Button>}
            />

            <SectionHeader
              eyebrow="Proof in the results"
              title="Omnichannel Automation, Singular Intelligence"
              description="Centered, for hero use."
              size="h2"
              as="h3"
              align="center"
            />

            <div
              className="rounded-card p-12"
              style={{ backgroundImage: gradients.healthHero }}
            >
              <SectionHeader
                eyebrow="AI for healthcare"
                title="Simplify Your Practice, Elevate Patient Care"
                description="The dark tone, on the health hero gradient."
                tone="dark"
                size="h2"
                as="h3"
                align="center"
              />
            </div>
          </div>
        </Section>

        {/* -- segmented control ---------------------------------------------- */}
        <Section
          eyebrow="Components"
          title="Segmented control"
          description="INFERRED — EliseAI ships no segmented control, so this is built from their verified pill system. Shared by U8's vertical filter and U12's scoreboard toggle. Click it, then arrow-key it."
        >
          <SegmentedDemo />
        </Section>

        {/* -- top nav -------------------------------------------------------- */}
        <Section
          eyebrow="Components"
          title="Top nav"
          description="Transparent, backdrop-blur 25px, with a 1px hairline that flips light/dark. The live bar is fixed; ours is sticky so pages can't forget the offset. The light variant is mounted at the top of this page."
        >
          <div
            className="relative overflow-hidden rounded-card"
            style={{ backgroundImage: gradients.healthHero }}
          >
            <TopNav
              tone="dark"
              actions={<Button variant="primary-dark" size="sm">Request Demo</Button>}
            />
            <div className="px-6 py-16">
              <SectionHeader
                eyebrow="Dark tone"
                title="Over a health-blue hero"
                tone="dark"
                size="h3"
                as="h3"
              />
            </div>
          </div>
        </Section>

        {/* -- composition ------------------------------------------------------ */}
        <Section
          eyebrow="Putting it together"
          title="A feed row, assembled"
          description="How U8's feed composes — built only from this kit, on EliseAI's own flat card, type, and filled primary button. Colour encodes signal identity (one saturated gradient per kind), never decoration. Three pills already say 'three signals firing', so no count badge; the clock already shows age, so no freshness badge. The vertical isn't tagged — the practice name says it, and the segmented control filters on it. The filter below is live: switch to Orthopedics to see the empty state."
        >
          <div className="flex flex-col gap-10">
            <FeedDemo />

            {/* The anti-pattern, labelled — so U8 recognises it rather than ships it. */}
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone="danger">Don&apos;t</Badge>
                <h3 className="font-display text-h5 text-ink">Chip soup</h3>
              </div>
              <p className="max-w-text font-sans text-sm text-ink-muted">
                The same lead, worse. A count badge that repeats what the pills already
                say; a freshness badge that repeats what the clock already shows; four
                identical grey pills that carry no identity; and a low-value grey line.
                Seven competing objects, none emphasised — multiply by twenty rows. Note
                the pale tints: EliseAI fills a pill saturated or near-black, never pastel.
              </p>

              {/* `flat` (not `outlined`) so the only border-colour utility here is
                  this one — two would resolve by stylesheet order, not by intent. */}
              <Card variant="flat" padding="md" className="border border-danger/30">
                <div className="flex flex-wrap items-start justify-between gap-6 opacity-60">
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="brand">3 signals firing</Badge>
                      <Badge tone="success">Fresh · 2 days</Badge>
                    </div>
                    <h4 className="font-display text-h5 text-ink">
                      Example Dermatology Group
                    </h4>
                    <p className="font-sans text-sm text-ink-muted">Sample row · 4 locations</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Tag tone="health">Dermatology</Tag>
                      <Tag>Staffing spike</Tag>
                      <Tag>Phone complaints</Tag>
                      <Tag>Growth event</Tag>
                    </div>
                  </div>
                  <Button variant="secondary" size="sm">
                    View brief
                  </Button>
                </div>
              </Card>
            </div>
          </div>
        </Section>
      </main>
    </>
  );
}
