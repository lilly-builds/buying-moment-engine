import type { Metadata, Viewport } from "next";
import { Inter, Inter_Tight, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { MobileTabBar } from "@/design/components/mobile-tab-bar";
import { Onboarding } from "./onboarding/onboarding";

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

export const metadata: Metadata = {
  title: "GTM Maestro — Buying-Moment Engine",
  description:
    "A push feed of healthcare practices at a buying moment, each with a verified, source-linked brief.",
};

// `cover` lets the page paint under the phone's home indicator / notch, which is
// what makes `env(safe-area-inset-*)` non-zero — the mobile bottom tab bar and the
// body clearance in globals.css both rely on that inset to clear the home indicator.
export const viewport: Viewport = {
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${interTight.variable} ${inter.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        {/* The phone bottom-nav lives at the document root so no page-level
            containing block can un-fix it (see MobileTabBar). Renders nothing at
            md:+ and on the auth / immersive screens. */}
        <MobileTabBar />
        {/* Onboarding front door. Asks once (AE vs RevOps) on the first visit to the
            feed, then mounts the matching coach-through — the AE "work your first
            lead" walk or the RevOps "connect your stack" walk. Mounted here so it
            survives the cross-page walk; renders nothing unless a tour is active or
            the chooser is showing. (Per-user role persistence is the follow-up;
            today the choice lives in localStorage — see ./onboarding/onboarding.) */}
        <Onboarding />
      </body>
    </html>
  );
}
