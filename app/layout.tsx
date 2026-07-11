import type { Metadata } from "next";
import { cache } from "react";
import { Inter, Inter_Tight, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { brandVars } from "@/design/brand";
import { BrandProvider } from "@/design/brand-provider";
import { getActiveWorkspace } from "@/src/workspace/active";
import { RevopsTour } from "./onboarding/revops-tour";

/**
 * Resolve the active workspace once per request. `cache` dedupes the cookie read +
 * DB lookup shared by `generateMetadata` and the layout render below.
 */
const resolveActiveWorkspace = cache(getActiveWorkspace);

/**
 * EliseAI's three real families (U2 / R15). `document.fonts` on eliseai.com
 * confirms the live site loads all three:
 *   Inter Tight   — display / headings, at the 450 "book" weight
 *   Inter         — body copy, nav items, buttons
 *   IBM Plex Mono — stat labels + count chips (NOT hero eyebrows; see tokens.ts)
 *
 * Inter and Inter Tight are variable fonts, so they take no `weight`. IBM Plex
 * Mono is not variable, so its weights are enumerated.
 */
const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const { config } = await resolveActiveWorkspace();
  return {
    title: `${config.brand.productName} — Buying-Moment Engine`,
    description:
      "A push feed of companies at a buying moment, each with a verified, source-linked brief.",
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const workspace = await resolveActiveWorkspace();
  const brand = workspace.config.brand;
  const isDefault = workspace.id === "default";
  // The synthetic default keeps the hand-tuned EliseAI ramp in globals.css exactly
  // (empty override); a real tenant gets the derived re-skin. Injected server-side
  // on the wrapper below, so the correct theme is in the first paint — no flash.
  const brandStyleVars = isDefault ? {} : brandVars(brand);

  return (
    <html
      lang="en"
      className={`${interTight.variable} ${inter.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <BrandProvider brand={brand} vars={brandStyleVars} isDefault={isDefault}>
          {children}
          {/* The RevOps "connect your stack" coach-through (Thread 08) — the same
              spotlight tour the AE gets, walking feed → brief → integrations. Mounted
              here so it survives the cross-page walk; renders nothing unless active.
              (Targeting follow-up: pick per archetype — AE → OnboardingTour, RevOps →
              this. The AE tour component stays in ./onboarding/onboarding-tour.)

              Gated to the default (EliseAI) workspace: its copy is hard-coded to that
              engine (the "GTM Maestro" product name, healthcare examples, and the
              HubSpot/Anthropic/PDL connect story), so an adapted tenant would see the
              wrong product and the wrong examples. It stays hidden for tenants until a
              per-tenant tour is generated. */}
          {isDefault ? <RevopsTour /> : null}
        </BrandProvider>
      </body>
    </html>
  );
}
