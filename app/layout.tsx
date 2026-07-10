import type { Metadata } from "next";
import { Inter, Inter_Tight, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { OnboardingTour } from "./onboarding/onboarding-tour";

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
        {/* The guided "work your first lead" coach-through (U17). Mounted here so it
            survives the feed → brief navigation; renders nothing unless it's active. */}
        <OnboardingTour />
      </body>
    </html>
  );
}
