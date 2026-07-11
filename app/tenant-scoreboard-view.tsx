import { Badge, Card, PageContainer, SectionHeader, TopNav } from "@/design/components";

/**
 * The tenant scoreboard (Adapt-It P4) — the honest empty state a brand-new
 * workspace sees instead of EliseAI's global `roi_events`.
 *
 * The real scoreboard (`app/scoreboard-view.tsx`) aggregates roi_events across the
 * WHOLE database, which is EliseAI's own performance. A new tenant must never see
 * those numbers as if they were its own (plan § "scoreboard honesty"), so for any
 * non-default workspace we render this: a calm, on-brand board that names every
 * metric it will fill in, tied to the two loops the spec is built around (Smarter
 * tool / Smarter GTM), in plain voice. Nothing is fabricated — the numbers arrive
 * once the tenant works its leads.
 *
 * A plain server component: no interactivity, and it re-skins with the tenant brand
 * through the layout's `BrandProvider`, same as every other page.
 */

const LOOP_LABEL = {
  tool: "Smarter tool",
  gtm: "Smarter GTM",
} as const;

type Loop = keyof typeof LOOP_LABEL;

interface MetricPlan {
  name: string;
  blurb: string;
  loops: Loop[];
}

/** The two lagging outcomes — the honest headline numbers, still waiting. */
const OUTCOMES: MetricPlan[] = [
  {
    name: "Deals won",
    blurb: "The deals that close from prospects the engine surfaced for you.",
    loops: ["gtm"],
  },
  {
    name: "Cost to win a customer",
    blurb:
      "What each new customer costs once the engine is doing the sourcing, so you can see it drop.",
    loops: ["gtm"],
  },
];

/** The leading signs — the early numbers that move the two outcomes above. */
const LEADING: MetricPlan[] = [
  {
    name: "Prospects surfaced",
    blurb: "How many buying-moment prospects the engine puts in front of you.",
    loops: ["tool", "gtm"],
  },
  {
    name: "Briefs opened",
    blurb: "Which prospects your team actually worked, so you know what got used.",
    loops: ["tool"],
  },
  {
    name: "Meetings booked",
    blurb: "Prospects that turned into a real conversation.",
    loops: ["gtm"],
  },
  {
    name: "Signal to meeting rate",
    blurb:
      "Which buying-moment signals pay off, so you keep the winners and drop the rest.",
    loops: ["tool", "gtm"],
  },
  {
    name: "Good-lead rate",
    blurb:
      "How often your team marks a prospect good, so the engine learns what a good lead looks like.",
    loops: ["tool"],
  },
];

function LoopBadges({ loops }: { loops: Loop[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {loops.map((l) => (
        <Badge key={l} tone="neutral" size="sm">
          {LOOP_LABEL[l]}
        </Badge>
      ))}
    </div>
  );
}

/** An outcome tile — the metric, an honest "not yet" placeholder, and what it tracks. */
function OutcomeCard({ metric }: { metric: MetricPlan }) {
  return (
    <Card variant="elevated" padding="lg">
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <span className="font-sans text-base font-medium text-ink-strong">{metric.name}</span>
          <Badge tone="neutral" size="sm">
            Not measured yet
          </Badge>
        </div>
        <span className="font-display text-h2 font-book tracking-brand text-ink-faint">
          Waiting
        </span>
        <p className="font-sans text-sm text-ink-muted">{metric.blurb}</p>
        <LoopBadges loops={metric.loops} />
      </div>
    </Card>
  );
}

/** A leading-sign explainer — the metric name, what it tracks, and the loops it powers. */
function LeadingCard({ metric }: { metric: MetricPlan }) {
  return (
    <div className="flex flex-col gap-2 rounded-panel bg-surface-subtle p-5">
      <span className="font-display text-h5 text-ink">{metric.name}</span>
      <p className="font-sans text-sm text-ink-body">{metric.blurb}</p>
      <LoopBadges loops={metric.loops} />
    </div>
  );
}

export function TenantScoreboardView({ productName }: { productName: string }) {
  return (
    // The calm working surface — matches the feed and the customize studio.
    <div className="gradient-hero-calm flex flex-1 flex-col">
      <TopNav tone="dark" />

      <PageContainer className="pb-2 pt-10">
        <div className="flex flex-col gap-4 rounded-card border border-white/25 bg-white/5 p-8 backdrop-blur-sm">
          <SectionHeader
            eyebrow="Scoreboard"
            title="Your scoreboard fills in as you work leads"
            tone="dark"
            size="h2"
            as="h1"
          />
          <p className="max-w-2xl font-sans text-lg text-white/80">
            {productName} tracks its own impact, not a generic dashboard. Every number
            here earns its place because it helps you make a call: keep a signal or drop
            it, and put your team on the prospects that pay off. Work a few leads from
            your feed and these start to fill in.
          </p>
        </div>
      </PageContainer>

      <main className="flex flex-1 flex-col">
        <PageContainer className="pb-12 pt-6">
          <div className="flex flex-col gap-6">
            {/* The two outcomes — the honest headline numbers, still empty. */}
            <div className="grid gap-6 md:grid-cols-2">
              {OUTCOMES.map((m) => (
                <OutcomeCard key={m.name} metric={m} />
              ))}
            </div>

            {/* The leading signs the engine will start to show. */}
            <Card variant="elevated" padding="lg">
              <div className="flex flex-col gap-6">
                <SectionHeader
                  title="What you'll see as leads move"
                  description="The early signs that move the two outcomes above. Each one is something you can act on the same week."
                  size="h3"
                  as="h2"
                />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {LEADING.map((m) => (
                    <LeadingCard key={m.name} metric={m} />
                  ))}
                </div>
              </div>
            </Card>
          </div>
        </PageContainer>
      </main>
    </div>
  );
}
