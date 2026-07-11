import type { CSSProperties, ReactNode } from "react";
import type { VariantConfig, VariantKey } from "./variants";
import { SignalField } from "@/components/marketing/signal-field";

/* Font stacks come from the root layout's CSS vars. */
const DISPLAY = "var(--font-inter-tight), system-ui, sans-serif";
const BODY = "var(--font-inter), system-ui, sans-serif";
const MONO = "var(--font-ibm-plex-mono), ui-monospace, monospace";

const container = "mx-auto w-full max-w-[1120px] px-6";
const section = "py-20 sm:py-24";

/* ── small typographic helpers ─────────────────────────────────────────── */

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p
      className="text-[13px] font-semibold uppercase"
      style={{ fontFamily: MONO, color: "var(--accent)", letterSpacing: "0.08em" }}
    >
      {children}
    </p>
  );
}

function SectionTitle({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <h2
      className="text-[clamp(1.9rem,4vw,2.9rem)] font-medium"
      style={{ fontFamily: DISPLAY, color: "var(--ink)", letterSpacing: "-0.02em", lineHeight: 1.08, textWrap: "balance", ...style }}
    >
      {children}
    </h2>
  );
}

/* ── nav ───────────────────────────────────────────────────────────────── */

export function Nav({ config }: { config: VariantConfig }) {
  return (
    <header className="sticky top-0 z-30 border-b backdrop-blur-md" style={{ borderColor: "var(--line)", background: "color-mix(in srgb, var(--ground) 82%, transparent)" }}>
      <div className={`${container} flex h-16 items-center justify-between`}>
        <a href="#top" className="flex items-center gap-2.5">
          <span className="inline-block h-3 w-3 rounded-full" style={{ background: "var(--accent)" }} aria-hidden />
          <span className="text-[17px] font-semibold" style={{ fontFamily: DISPLAY, color: "var(--ink)", letterSpacing: "-0.01em" }}>
            {config.brand}
          </span>
        </a>
        <a
          href="#start"
          className="rounded-lg px-4 py-2 text-[14px] font-semibold transition hover:opacity-90"
          style={{ background: "var(--accent)", color: "var(--on-accent)" }}
        >
          {config.ctaPrimary}
        </a>
      </div>
    </header>
  );
}

/* ── hero ──────────────────────────────────────────────────────────────── */

// A tiny "sample morning" list for the hero visual. Illustrative, labelled.
const HERO_ROWS: Record<VariantKey, { company: string; signal: string }[]> = {
  saas: [
    { company: "Northwind Logistics", signal: "VENDOR SUNSET" },
    { company: "Aperture Data", signal: "NEW VP SALES" },
    { company: "Kentro Systems", signal: "HIRING FOR STACK" },
  ],
  outbound: [
    { company: "Sunbelt Dental Group", signal: "OPENING #4" },
    { company: "Harbor & Co Accounting", signal: "HIRING FAST" },
    { company: "Bloom Studios", signal: "NEW FUNDING" },
  ],
  founders: [
    { company: "Ridgeline HR", signal: "NEW REVOPS LEAD" },
    { company: "Camber Health", signal: "SWITCHING TOOLS" },
    { company: "Onyx Freight", signal: "JUST RAISED" },
  ],
};

export function Hero({ config, form }: { config: VariantConfig; form: ReactNode }) {
  const rows = HERO_ROWS[config.key];
  return (
    <section id="top" className="relative overflow-hidden" style={{ background: "var(--ground)" }}>
      {/* the living signal field: companies, and the moments igniting across them */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          WebkitMaskImage: "radial-gradient(130% 115% at 100% 0%, #000 22%, transparent 62%)",
          maskImage: "radial-gradient(130% 115% at 100% 0%, #000 22%, transparent 62%)",
        }}
      >
        <SignalField accent={config.theme.accent} cadence={1.0} calm={0.22} />
      </div>
      {/* soft accent glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 right-[-10%] h-[520px] w-[520px] rounded-full opacity-[0.10] blur-3xl"
        style={{ background: "var(--accent)" }}
      />
      <div className={`${container} relative z-10 grid items-center gap-14 pb-16 pt-16 sm:pt-20 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:pb-24`}>
        <div>
          <Eyebrow>{config.eyebrow}</Eyebrow>
          <h1
            className="mt-4 text-[clamp(2.4rem,6vw,4rem)] font-medium"
            style={{ fontFamily: DISPLAY, color: "var(--ink)", letterSpacing: "-0.025em", lineHeight: 1.04, textWrap: "balance" }}
          >
            {config.headline}{" "}
            <span style={{ color: "var(--accent)" }}>{config.headlineAccent}</span>
          </h1>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed" style={{ fontFamily: BODY, color: "var(--ink-muted)" }}>
            {config.subhead}
          </p>
          <div id="start" className="mt-8 max-w-xl scroll-mt-24">
            {form}
          </div>
        </div>

        {/* sample morning card */}
        <div className="lg:justify-self-end">
          <div
            className="w-full max-w-[420px] rounded-2xl border p-5 shadow-xl"
            style={{ background: "var(--card)", borderColor: "var(--line)", boxShadow: "0 24px 60px -30px color-mix(in srgb, var(--ink) 40%, transparent)" }}
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="text-[13px] font-semibold" style={{ fontFamily: MONO, color: "var(--ink-muted)", letterSpacing: "0.04em" }}>
                TOMORROW MORNING
              </span>
              <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                3 ready
              </span>
            </div>
            <div className="flex flex-col gap-2.5">
              {rows.map((r) => (
                <div key={r.company} className="flex items-center justify-between rounded-xl border px-3.5 py-3" style={{ borderColor: "var(--line)", background: "var(--ground)" }}>
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold" style={{ color: "var(--ink)" }}>{r.company}</p>
                    <p className="mt-0.5 text-[11px] font-semibold" style={{ fontFamily: MONO, color: "var(--accent)", letterSpacing: "0.03em" }}>{r.signal}</p>
                  </div>
                  <span className="ml-3 shrink-0 rounded-md px-2 py-1 text-[11px] font-medium" style={{ background: "var(--accent-soft)", color: "var(--ink-muted)" }}>
                    email ready
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-center text-[12px]" style={{ color: "var(--ink-muted)" }}>
              A sample morning. Yours is built from what you sell.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── proof bar ─────────────────────────────────────────────────────────── */

export function ProofBar({ config }: { config: VariantConfig }) {
  return (
    <section style={{ background: "var(--card)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
      <div className={`${container} py-12`}>
        <div className="grid gap-8 sm:grid-cols-3">
          {config.proofStats.map((s) => (
            <div key={s.label}>
              <p className="text-[clamp(1.5rem,3vw,2rem)] font-medium" style={{ fontFamily: DISPLAY, color: "var(--ink)", letterSpacing: "-0.02em" }}>
                {s.big}
              </p>
              <p className="mt-1 text-[14px] leading-snug" style={{ fontFamily: BODY, color: "var(--ink-muted)" }}>
                {s.label}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-8 max-w-2xl text-[15px] leading-relaxed" style={{ fontFamily: BODY, color: "var(--ink)" }}>
          {config.proofNote}
        </p>
      </div>
    </section>
  );
}

/* ── how it works ──────────────────────────────────────────────────────── */

export function HowItWorks({ config }: { config: VariantConfig }) {
  return (
    <section className={section} style={{ background: "var(--ground)" }}>
      <div className={container}>
        <Eyebrow>How it works</Eyebrow>
        <SectionTitle style={{ marginTop: "0.75rem", maxWidth: "18ch" }}>{config.stepsIntro}</SectionTitle>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {config.steps.map((s) => (
            <div key={s.n} className="rounded-2xl border p-6" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
              <span className="text-[13px] font-semibold" style={{ fontFamily: MONO, color: "var(--accent)", letterSpacing: "0.06em" }}>{s.n}</span>
              <h3 className="mt-3 text-[19px] font-semibold" style={{ fontFamily: DISPLAY, color: "var(--ink)", letterSpacing: "-0.01em" }}>{s.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed" style={{ fontFamily: BODY, color: "var(--ink-muted)" }}>{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── the example brief (the money section) ─────────────────────────────── */

export function BriefShowcase({ config }: { config: VariantConfig }) {
  const b = config.brief;
  return (
    <section className={section} style={{ background: "var(--card)" }}>
      <div className={container}>
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow>See it once, you get it</Eyebrow>
          <SectionTitle style={{ marginTop: "0.75rem" }}>{config.showcaseTitle}</SectionTitle>
          <p className="mx-auto mt-4 max-w-xl text-[16px] leading-relaxed" style={{ fontFamily: BODY, color: "var(--ink-muted)" }}>{config.showcaseSub}</p>
        </div>

        {/* the brief card on the deep surface */}
        <div
          className="mx-auto mt-12 max-w-3xl overflow-hidden rounded-3xl"
          style={{ background: "var(--deep)", boxShadow: "0 40px 90px -50px color-mix(in srgb, var(--ink) 70%, transparent)" }}
        >
          <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: "color-mix(in srgb, var(--on-deep) 12%, transparent)" }}>
            <span className="text-[12px] font-semibold" style={{ fontFamily: MONO, color: "var(--on-deep-muted)", letterSpacing: "0.08em" }}>
              EXAMPLE BRIEF
            </span>
            <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: "var(--accent)", color: "var(--on-accent)", fontFamily: MONO, letterSpacing: "0.04em" }}>
              {b.signalLabel}
            </span>
          </div>

          <div className="px-6 py-6 sm:px-8">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="text-[24px] font-semibold" style={{ fontFamily: DISPLAY, color: "var(--on-deep)", letterSpacing: "-0.01em" }}>{b.company}</h3>
              <p className="text-[13px]" style={{ fontFamily: MONO, color: "var(--on-deep-muted)" }}>{b.meta}</p>
            </div>

            <p className="mt-4 text-[15px] leading-relaxed" style={{ fontFamily: BODY, color: "var(--on-deep)" }}>
              <span className="font-semibold" style={{ color: "var(--on-deep)" }}>Why now: </span>
              <span style={{ color: "color-mix(in srgb, var(--on-deep) 82%, transparent)" }}>{b.whyNow}</span>
            </p>

            {/* citations */}
            <div className="mt-4 flex flex-wrap gap-2">
              {b.citations.map((c) => (
                <span key={c.label} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: "color-mix(in srgb, var(--on-deep) 8%, transparent)", color: "var(--on-deep-muted)" }}>
                  <span aria-hidden style={{ color: "var(--accent)" }}>◆</span>
                  <span style={{ color: "var(--on-deep)" }}>{c.label}</span>
                  <span aria-hidden>·</span>
                  <span style={{ fontFamily: MONO }}>{c.source}</span>
                </span>
              ))}
            </div>

            {/* contact + email */}
            <div className="mt-6 rounded-2xl p-5" style={{ background: "color-mix(in srgb, var(--on-deep) 7%, transparent)" }}>
              <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: "color-mix(in srgb, var(--on-deep) 12%, transparent)" }}>
                <div>
                  <p className="text-[14px] font-semibold" style={{ color: "var(--on-deep)" }}>{b.contact.name}</p>
                  <p className="text-[12px]" style={{ color: "var(--on-deep-muted)" }}>{b.contact.title}</p>
                </div>
                <span className="rounded-md px-2 py-1 text-[11px] font-semibold" style={{ background: "var(--accent)", color: "var(--on-accent)" }}>Draft ready</span>
              </div>
              <p className="mt-3 text-[13px]" style={{ fontFamily: MONO, color: "var(--on-deep-muted)" }}>
                Subject: <span style={{ color: "var(--on-deep)" }}>{b.email.subject}</span>
              </p>
              <div className="mt-3 flex flex-col gap-2.5">
                {b.email.body.map((p, i) => (
                  <p key={i} className="text-[14px] leading-relaxed" style={{ fontFamily: BODY, color: "color-mix(in srgb, var(--on-deep) 88%, transparent)" }}>{p}</p>
                ))}
                <p className="text-[14px]" style={{ fontFamily: BODY, color: "var(--on-deep-muted)" }}>{b.email.sign}</p>
              </div>
            </div>

            <p className="mt-5 text-center text-[12px]" style={{ color: "var(--on-deep-muted)" }}>{b.caption}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── differentiator ────────────────────────────────────────────────────── */

export function Differentiator({ config }: { config: VariantConfig }) {
  return (
    <section className={section} style={{ background: "var(--ground)" }}>
      <div className={container}>
        <SectionTitle style={{ maxWidth: "16ch" }}>{config.diffTitle}</SectionTitle>
        <div className="mt-12 grid gap-x-10 gap-y-9 sm:grid-cols-2">
          {config.diffPoints.map((p) => (
            <div key={p.title} className="flex gap-4">
              <span aria-hidden className="mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: "var(--accent)" }} />
              <div>
                <h3 className="text-[18px] font-semibold" style={{ fontFamily: DISPLAY, color: "var(--ink)", letterSpacing: "-0.01em" }}>{p.title}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed" style={{ fontFamily: BODY, color: "var(--ink-muted)" }}>{p.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── pricing ───────────────────────────────────────────────────────────── */

export function Pricing({ config }: { config: VariantConfig }) {
  return (
    <section id="pricing" className={section} style={{ background: "var(--card)" }}>
      <div className={container}>
        <div className="max-w-2xl">
          <Eyebrow>Pricing</Eyebrow>
          <SectionTitle style={{ marginTop: "0.75rem" }}>{config.pricingTitle}</SectionTitle>
          <p className="mt-4 text-[16px] leading-relaxed" style={{ fontFamily: BODY, color: "var(--ink-muted)" }}>{config.pricingSub}</p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {config.tiers.map((t) => (
            <div
              key={t.name}
              className="relative flex flex-col rounded-2xl border p-6"
              style={
                t.highlight
                  ? { borderColor: "var(--accent)", background: "var(--ground)", boxShadow: "0 20px 50px -30px color-mix(in srgb, var(--accent) 60%, transparent)" }
                  : { borderColor: "var(--line)", background: "var(--ground)" }
              }
            >
              {t.highlight && (
                <span className="absolute -top-3 left-6 rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: "var(--accent)", color: "var(--on-accent)", fontFamily: MONO, letterSpacing: "0.04em" }}>
                  MOST PICK THIS
                </span>
              )}
              <h3 className="text-[15px] font-semibold uppercase" style={{ fontFamily: MONO, color: "var(--ink-muted)", letterSpacing: "0.06em" }}>{t.name}</h3>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-[40px] font-medium leading-none" style={{ fontFamily: DISPLAY, color: "var(--ink)", letterSpacing: "-0.02em" }}>{t.price}</span>
                <span className="text-[15px]" style={{ color: "var(--ink-muted)" }}>{t.cadence}</span>
              </div>
              <p className="mt-2 text-[14px] leading-snug" style={{ fontFamily: BODY, color: "var(--ink-muted)" }}>{t.blurb}</p>
              <ul className="mt-5 flex flex-1 flex-col gap-2.5">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-[14px]" style={{ fontFamily: BODY, color: "var(--ink)" }}>
                    <span aria-hidden className="mt-0.5 font-bold" style={{ color: "var(--accent)" }}>✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <a
                href="#start"
                className="mt-6 rounded-xl px-4 py-3 text-center text-[15px] font-semibold transition hover:opacity-90"
                style={t.highlight ? { background: "var(--accent)", color: "var(--on-accent)" } : { background: "var(--accent-soft)", color: "var(--accent)" }}
              >
                {t.cta}
              </a>
            </div>
          ))}
        </div>
        <p className="mt-8 max-w-2xl text-[13px] leading-relaxed" style={{ fontFamily: BODY, color: "var(--ink-muted)" }}>{config.pricingFootnote}</p>
      </div>
    </section>
  );
}

/* ── guarantee band ────────────────────────────────────────────────────── */

export function Guarantee({ config }: { config: VariantConfig }) {
  return (
    <section className="py-16" style={{ background: "var(--ground)" }}>
      <div className={container}>
        <div className="rounded-3xl border-2 p-8 sm:p-10" style={{ borderColor: "var(--accent)", background: "var(--accent-soft)" }}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
            <span aria-hidden className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[20px]" style={{ background: "var(--accent)", color: "var(--on-accent)" }}>
              ✓
            </span>
            <div>
              <h3 className="text-[clamp(1.4rem,3vw,1.9rem)] font-medium" style={{ fontFamily: DISPLAY, color: "var(--ink)", letterSpacing: "-0.02em", textWrap: "balance" }}>{config.guaranteeTitle}</h3>
              <p className="mt-3 max-w-2xl text-[15px] leading-relaxed" style={{ fontFamily: BODY, color: "var(--ink)" }}>{config.guaranteeBody}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── faq (no-JS accordion) ─────────────────────────────────────────────── */

export function Faq({ config }: { config: VariantConfig }) {
  return (
    <section className={section} style={{ background: "var(--card)" }}>
      <div className={container}>
        <SectionTitle>{config.faqTitle}</SectionTitle>
        <div className="mt-10 grid gap-3 md:max-w-3xl">
          {config.faqs.map((f) => (
            <details key={f.q} className="group rounded-xl border px-5 py-4" style={{ borderColor: "var(--line)", background: "var(--ground)" }}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-semibold" style={{ fontFamily: DISPLAY, color: "var(--ink)" }}>
                {f.q}
                <span aria-hidden className="shrink-0 text-[20px] transition group-open:rotate-45" style={{ color: "var(--accent)" }}>+</span>
              </summary>
              <p className="mt-3 text-[15px] leading-relaxed" style={{ fontFamily: BODY, color: "var(--ink-muted)" }}>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── final cta ─────────────────────────────────────────────────────────── */

export function FinalCta({ config, form }: { config: VariantConfig; form: ReactNode }) {
  return (
    <section className="py-24" style={{ background: "var(--deep)" }}>
      <div className={`${container} text-center`}>
        <h2 className="mx-auto max-w-2xl text-[clamp(2rem,4.5vw,3.2rem)] font-medium" style={{ fontFamily: DISPLAY, color: "var(--on-deep)", letterSpacing: "-0.025em", lineHeight: 1.06, textWrap: "balance" }}>
          {config.finalTitle}
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-[17px] leading-relaxed" style={{ fontFamily: BODY, color: "var(--on-deep-muted)" }}>{config.finalSub}</p>
        <div className="mx-auto mt-8 max-w-xl rounded-2xl border p-5 text-left sm:p-6" style={{ background: "var(--ground)", borderColor: "color-mix(in srgb, var(--on-deep) 14%, transparent)" }}>
          {form}
        </div>
      </div>
    </section>
  );
}

/* ── footer ────────────────────────────────────────────────────────────── */

export function Footer({ config }: { config: VariantConfig }) {
  return (
    <footer style={{ background: "var(--deep)", borderTop: "1px solid color-mix(in srgb, var(--on-deep) 12%, transparent)" }}>
      <div className={`${container} flex flex-col gap-3 py-8 sm:flex-row sm:items-center sm:justify-between`}>
        <div className="flex items-center gap-2.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "var(--accent)" }} aria-hidden />
          <span className="text-[15px] font-semibold" style={{ fontFamily: DISPLAY, color: "var(--on-deep)" }}>{config.brand}</span>
        </div>
        <p className="text-[13px]" style={{ fontFamily: BODY, color: "var(--on-deep-muted)" }}>
          Tell us what you sell. We find the moment they need it.
        </p>
      </div>
    </footer>
  );
}
