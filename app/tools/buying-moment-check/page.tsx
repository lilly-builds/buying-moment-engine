import type { Metadata } from "next";
import Link from "next/link";
import { PlaybookTool } from "./playbook-tool";

export const metadata: Metadata = {
  title: "Free tool: your buying-moment playbook — Buying Moment",
  description:
    "Tell us what you sell and get an instant playbook of the public buying moments that mean a company needs it, plus what a ready-to-send brief looks like. Free, no signup.",
  openGraph: {
    title: "Free tool: your buying-moment playbook",
    description:
      "The public moments that mean a company is ready to buy what you sell, and what a ready brief looks like. Free.",
    type: "website",
  },
};

const DISPLAY = "var(--font-inter-tight), system-ui, sans-serif";
const BODY = "var(--font-inter), system-ui, sans-serif";
const MONO = "var(--font-ibm-plex-mono), ui-monospace, monospace";

/**
 * The free lead-magnet tool — Channel 2's top of funnel. Public, static shell +
 * a client tool. Neutral "Buying Moment" brand (not tied to a variant theme),
 * because it feeds all three experiments. No product data, no auth.
 */
export default function ToolPage() {
  return (
    <main style={{ background: "#ffffff", color: "#0b1020", minHeight: "100vh" }}>
      <header className="mx-auto flex w-full max-w-[820px] items-center justify-between px-6 py-6">
        <Link href="/tools/buying-moment-check" className="flex items-center gap-2.5">
          <span className="inline-block h-3 w-3 rounded-full" style={{ background: "#4f46e5" }} aria-hidden />
          <span className="text-[17px] font-semibold" style={{ fontFamily: DISPLAY, letterSpacing: "-0.01em" }}>Buying Moment</span>
        </Link>
        <Link href="/for/outbound?utm_source=tool&utm_medium=referral&utm_campaign=nav" className="text-[14px] font-semibold" style={{ color: "#4f46e5" }}>
          See how it works
        </Link>
      </header>

      <section className="mx-auto w-full max-w-[820px] px-6 pb-24 pt-6">
        <p className="text-[13px] font-semibold uppercase" style={{ fontFamily: MONO, color: "#4f46e5", letterSpacing: "0.08em" }}>
          Free tool, no signup
        </p>
        <h1 className="mt-3 text-[clamp(2rem,5vw,3rem)] font-medium" style={{ fontFamily: DISPLAY, letterSpacing: "-0.025em", lineHeight: 1.06, textWrap: "balance" }}>
          Your buying-moment playbook
        </h1>
        <p className="mt-4 max-w-2xl text-[17px] leading-relaxed" style={{ fontFamily: BODY, color: "#5b6472" }}>
          Tell us what you sell. In one click you get the exact public moments that mean a company is ready to buy it, where
          each one shows up, and what a ready-to-send brief looks like. No email required to see it.
        </p>

        <div className="mt-10">
          <PlaybookTool />
        </div>
      </section>
    </main>
  );
}
