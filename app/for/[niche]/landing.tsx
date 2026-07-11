import type { CSSProperties } from "react";
import type { VariantConfig } from "./variants";
import { PageViewBeacon } from "./beacon";
import { SignupForm } from "./signup-form";
import {
  BriefShowcase,
  Differentiator,
  Faq,
  FinalCta,
  Footer,
  Guarantee,
  Hero,
  HowItWorks,
  Nav,
  Pricing,
  ProofBar,
} from "./sections";

/**
 * Assembles one landing experiment from its config. The theme is applied ONCE
 * here as CSS custom properties on the root wrapper; every section reads them
 * via var(--...), so the same section code renders three distinct worlds. The
 * fonts (--font-inter-tight / --font-inter / --font-ibm-plex-mono) come from the
 * app's root layout, so no font loading happens here.
 */
export function Landing({ config }: { config: VariantConfig }) {
  const t = config.theme;
  const themeVars = {
    "--accent": t.accent,
    "--on-accent": t.onAccent,
    "--accent-soft": t.accentSoft,
    "--ground": t.ground,
    "--ink": t.ink,
    "--ink-muted": t.inkMuted,
    "--line": t.line,
    "--card": t.card,
    "--deep": t.deep,
    "--on-deep": t.onDeep,
    "--on-deep-muted": t.onDeepMuted,
  } as CSSProperties;

  return (
    <main style={{ ...themeVars, background: t.ground, color: t.ink }}>
      <PageViewBeacon variant={config.key} />
      <Nav config={config} />
      <Hero
        config={config}
        form={
          <SignupForm
            variant={config.key}
            place="hero"
            ctaLabel={config.ctaPrimary}
            ctaSub={config.ctaSub}
            sellPlaceholder={config.sellPlaceholder}
          />
        }
      />
      <ProofBar config={config} />
      <HowItWorks config={config} />
      <BriefShowcase config={config} />
      <Differentiator config={config} />
      <Pricing config={config} />
      <Guarantee config={config} />
      <Faq config={config} />
      <FinalCta
        config={config}
        form={
          <SignupForm
            variant={config.key}
            place="final"
            ctaLabel={config.ctaPrimary}
            ctaSub={config.ctaSub}
            sellPlaceholder={config.sellPlaceholder}
          />
        }
      />
      <Footer config={config} />
    </main>
  );
}
