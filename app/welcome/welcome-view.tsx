import Link from "next/link";
import {
  Badge,
  ButtonLink,
  Card,
  LogoMark,
  PageContainer,
  Reveal,
  SectionHeader,
} from "@/design/components";
import { SampleSignalPill } from "../sample-signal-pill";

/**
 * The marketing front door (Adapt-It P5) — the SaaS shell "Moment," for an anonymous
 * visitor. Built entirely on the kit: the design system's own gradients and type are
 * the visual interest, so there is no stock photography. One clear decision on the
 * page (adapt it), with "see it live" as the quiet second choice.
 *
 * Surface rhythm carries the differentiation this phase is about: the page opens and
 * closes on the full arrival hero and breathes through calm neutral bands between, so
 * it never reads as one flat wall of blue. Motion is restrained and purposeful — the
 * hero is always visible (no entrance that could hide critical copy), and the
 * below-the-fold sections lift into view once via `Reveal`, which is reduced-motion
 * aware. A server component: every animation is CSS or the client `Reveal` wrapper.
 *
 * "Moment" is the shell name (north star), rendered as fixed marketing copy rather
 * than the active workspace's wordmark, so the front door reads the same for everyone.
 */

const STEPS = [
  {
    title: "Tell the Adapter about you",
    body: "Answer a few quick questions, or just paste your website. That is all it needs to start.",
  },
  {
    title: "Watch it build your engine",
    body: "Your buying signals, your pitch, your proof, and your brand, all generated and all yours to edit.",
  },
  {
    title: "Work your feed of prospects",
    body: "Open a dashboard already full of companies at a buying moment, each with a brief written in your voice.",
  },
] as const;

const LEVERS = [
  {
    title: "Brand",
    body: "Your name, your colors, your wordmark, painted across every screen.",
  },
  {
    title: "Buying-moment signals",
    body: "The moments that predict a buy. Keep ours, reword them, or add your own.",
  },
  {
    title: "Pitch",
    body: "How your team opens, what they ask, and how they handle pushback.",
  },
  {
    title: "Proof",
    body: "The results a buyer cares about, formatted into a clean proof point.",
  },
] as const;

export function WelcomeView() {
  return (
    <main className="flex flex-1 flex-col">
      <Hero />
      <HowItWorks />
      <Levers />
      <ClosingCta />
      <Footer />
    </main>
  );
}

/** The opening band — the promise, the two ways forward, and a live product preview. */
function Hero() {
  return (
    <section className="gradient-hero relative overflow-hidden">
      {/* An ambient brand glow, top-right, for depth behind the copy. Decorative. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-32 -top-40 h-[36rem] w-[36rem] rounded-full gradient-orb opacity-25 blur-3xl motion-safe:animate-pulse [animation-duration:7s]"
      />

      {/* Marketing header — static over the hero (not sticky), so its white ink never
          lands on a light band below. Logo left, sign-in + the one primary right. */}
      <PageContainer as="header" className="relative flex h-[72px] items-center justify-between gap-6">
        <span className="flex items-center gap-2.5 text-white">
          <LogoMark size={28} />
          <span className="font-display text-xl font-book tracking-brand">Moment</span>
        </span>
        <div className="flex items-center gap-5">
          <Link
            href="/login"
            className="rounded-control font-sans text-base text-white/80 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Sign in
          </Link>
          <ButtonLink href="/adapt" variant="primary-dark" size="sm">
            Adapt it
          </ButtonLink>
        </div>
      </PageContainer>

      <PageContainer className="relative pb-section-tight pt-16 lg:pb-section lg:pt-20">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="flex flex-col items-start gap-7">
            <span className="font-sans text-base font-medium uppercase tracking-eyebrow text-white/85">
              The buying-moment engine
            </span>
            <h1 className="max-w-2xl font-display text-h1 font-book tracking-brand text-balance text-white">
              Reach every buyer at their buying moment.
            </h1>
            <p className="max-w-xl font-sans text-xl text-pretty text-white/85">
              Moment adapts to your business in about two minutes. It learns the signals
              that say a company is ready to buy, writes your pitch and your proof, and
              paints the whole app in your brand. Then it hands your team a live feed of
              prospects, each with a brief ready to send.
            </p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
              <ButtonLink href="/adapt" variant="primary-dark" size="lg">
                Adapt it to your business
              </ButtonLink>
              <Link
                href="/"
                className="group inline-flex items-center gap-2 rounded-control font-sans text-lg font-book tracking-control text-white transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                See it live
                <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
                  &rarr;
                </span>
              </Link>
            </div>
          </div>

          <HeroPreview />
        </div>
      </PageContainer>
    </section>
  );
}

/**
 * A show-don't-tell product preview — a floating brief card with a second row peeking
 * behind it, so the promise ("a live feed of prospects") is visible, not just claimed.
 * Built from the kit; the signal pills wear the real signal gradients.
 */
function HeroPreview() {
  return (
    <div className="relative mx-auto w-full max-w-md motion-safe:animate-card-glide-in">
      {/* The row peeking behind, to imply a feed. */}
      <div
        aria-hidden
        className="absolute -right-3 -top-5 hidden h-24 w-[92%] rounded-card bg-white/70 shadow-soft ring-1 ring-ink/[0.06] sm:block"
      />
      <Card variant="elevated" padding="lg" className="relative">
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-xs uppercase tracking-eyebrow text-ink-faint">
              Live feed
            </span>
            <Badge tone="neutral" size="sm">
              2 days ago
            </Badge>
          </div>
          <div className="flex flex-col gap-2">
            <p className="font-display text-h4 text-ink">Northwind Logistics</p>
            <p className="font-sans text-base text-ink-body">
              Just posted 12 driver roles across three depots.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SampleSignalPill name="Fleet expansion" />
            <SampleSignalPill name="Hiring surge" />
          </div>
          <div className="pt-1">
            <ButtonLink href="/" variant="primary" size="sm">
              View brief
            </ButtonLink>
          </div>
        </div>
      </Card>
    </div>
  );
}

/** How it works — three plain steps, on a calm neutral band. */
function HowItWorks() {
  return (
    <section className="bg-surface">
      <PageContainer className="flex flex-col gap-12 py-section-tight lg:py-section">
        <Reveal>
          <SectionHeader
            eyebrow="How it works"
            title="From your website to a working feed, in three steps."
            size="h2"
            as="h2"
          />
        </Reveal>
        <div className="grid gap-6 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <Reveal key={step.title} delayMs={i * 110}>
              <Card variant="raised" padding="lg" className="h-full">
                <div className="flex h-full flex-col gap-4">
                  <span
                    aria-hidden
                    className="flex h-9 w-9 items-center justify-center rounded-pill gradient-brand font-mono text-sm font-medium text-white shadow-ring"
                  >
                    {i + 1}
                  </span>
                  <h3 className="font-display text-h5 text-ink">{step.title}</h3>
                  <p className="font-sans text-base text-ink-body">{step.body}</p>
                </div>
              </Card>
            </Reveal>
          ))}
        </div>
      </PageContainer>
    </section>
  );
}

/** The customization levers — a subtle band so it reads distinct from the white above. */
function Levers() {
  return (
    <section className="bg-surface-canvas">
      <PageContainer className="flex flex-col gap-12 py-section-tight lg:py-section">
        <Reveal>
          <SectionHeader
            eyebrow="Made yours"
            title="Every lever the Adapter sets is yours to change."
            description="The Adapter gives you a strong start. The Customization Studio lets you shape all of it, and the whole app updates as you go."
            size="h2"
            as="h2"
          />
        </Reveal>
        <div className="grid gap-6 sm:grid-cols-2">
          {LEVERS.map((lever, i) => (
            <Reveal key={lever.title} delayMs={(i % 2) * 110}>
              <Card variant="outlined" padding="lg" className="h-full">
                <div className="flex h-full flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <LogoMark size={22} />
                    <h3 className="font-display text-h5 text-ink">{lever.title}</h3>
                  </div>
                  <p className="font-sans text-base text-ink-body">{lever.body}</p>
                </div>
              </Card>
            </Reveal>
          ))}
        </div>
      </PageContainer>
    </section>
  );
}

/** The closing invitation — back on the full hero, bookending the page in brand. */
function ClosingCta() {
  return (
    <section className="gradient-hero relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -left-40 bottom-[-14rem] h-[34rem] w-[34rem] rounded-full gradient-orb opacity-20 blur-3xl"
      />
      <PageContainer className="relative py-section-tight lg:py-section">
        <Reveal className="flex flex-col items-center gap-7 text-center">
          <h2 className="max-w-2xl font-display text-h2 font-book tracking-brand text-balance text-white">
            Ready to see it adapt to you?
          </h2>
          <p className="max-w-xl font-sans text-xl text-pretty text-white/85">
            It takes about two minutes, and everything the Adapter sets is yours to edit.
          </p>
          <ButtonLink href="/adapt" variant="primary-dark" size="lg">
            Adapt it to your business
          </ButtonLink>
        </Reveal>
      </PageContainer>
    </section>
  );
}

/** A quiet footer — the mark, the promise, and the two quiet ways in. */
function Footer() {
  return (
    <footer className="border-t border-line-soft bg-surface">
      <PageContainer className="flex flex-col items-center justify-between gap-4 py-8 sm:flex-row">
        <span className="flex items-center gap-2.5 text-ink">
          <LogoMark size={24} />
          <span className="font-display text-lg font-book tracking-brand">Moment</span>
          <span className="font-sans text-sm text-ink-muted">
            Reach every buyer at their buying moment.
          </span>
        </span>
        <div className="flex items-center gap-5">
          <Link
            href="/"
            className="rounded-control font-sans text-sm text-ink-muted transition-colors hover:text-ink"
          >
            See it live
          </Link>
          <Link
            href="/login"
            className="rounded-control font-sans text-sm text-ink-muted transition-colors hover:text-ink"
          >
            Sign in
          </Link>
        </div>
      </PageContainer>
    </footer>
  );
}
