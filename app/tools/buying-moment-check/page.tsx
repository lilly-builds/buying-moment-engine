import type { Metadata } from "next";
import Link from "next/link";
import { SignalField } from "@/components/marketing/signal-field";
import { Finder } from "./playbook-tool";

export const metadata: Metadata = {
  title: "Free: see which companies need what you sell, right now — Buying Moment",
  description:
    "Tell us what you sell and get a real, researched example of a company that needs it, with the public signals that prove it. Then get 5 built for you, free. No signup to see it.",
  openGraph: {
    title: "See which companies need what you sell, right now",
    description: "One real, researched buying moment, free, no signup. Then 5 more built for what you sell.",
    type: "website",
  },
};

const DISPLAY = "var(--font-inter-tight), system-ui, sans-serif";
const BODY = "var(--font-inter), system-ui, sans-serif";
const MONO = "var(--font-ibm-plex-mono), ui-monospace, monospace";

/* Dark "intelligence console" world, scoped to the tool. The signal field glows
   against near-black; the input and animated states read against it. */
const scoped = `
  .finder-field {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.12);
    color: #eef1ff;
    outline: none;
    transition: border-color .15s ease, box-shadow .15s ease, background .15s ease;
  }
  .finder-field::placeholder { color: #6b74a0; }
  .finder-field:focus {
    border-color: #818cf8;
    background: rgba(255,255,255,0.06);
    box-shadow: 0 0 0 3px rgba(99,102,241,0.25);
  }
  .finder-field:disabled { opacity: .6; }
  @keyframes finder-scan { 0% { transform: translateX(-120%);} 100% { transform: translateX(400%);} }
  .finder-scanbar { animation: finder-scan 1s cubic-bezier(0.4,0,0.2,1) infinite; }
  @keyframes finder-blink { 0%,49%{opacity:1} 50%,100%{opacity:0} }
  .finder-blink { animation: finder-blink 1s step-end infinite; }
  @keyframes finder-pulse { 0%{ box-shadow: 0 0 0 0 rgba(56,224,212,0.6);} 70%{ box-shadow: 0 0 0 6px rgba(56,224,212,0);} 100%{ box-shadow: 0 0 0 0 rgba(56,224,212,0);} }
  .finder-pulse { animation: finder-pulse 1.8s ease-out infinite; }
  @keyframes finder-shimmer { 0%,100%{opacity:.5} 50%{opacity:.9} }
  .finder-shimmer { animation: finder-shimmer 1.8s ease-in-out infinite; }
  .finder-scope ::selection { background: rgba(129,140,248,0.3); }
  @media (prefers-reduced-motion: reduce) {
    .finder-scanbar, .finder-blink, .finder-pulse, .finder-shimmer { animation: none; }
  }
`;

/**
 * The free finder tool: Channel 2, and the top of funnel. Public, dark console
 * world with a full-bleed SignalField. No product data, no auth.
 */
export default function ToolPage() {
  return (
    <main className="finder-scope relative min-h-screen overflow-hidden" style={{ background: "#080a14", color: "#eef1ff", fontFamily: BODY }}>
      <style>{scoped}</style>

      {/* the living field, full-bleed, glowing against near-black */}
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{
        WebkitMaskImage: "radial-gradient(120% 90% at 50% 0%, #000 30%, transparent 78%)",
        maskImage: "radial-gradient(120% 90% at 50% 0%, #000 30%, transparent 78%)",
      }}>
        <SignalField accent="#7c83ff" cadence={0.85} calm={0.26} density={5} />
      </div>
      {/* ambient glow */}
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[-12%] h-[560px] w-[820px] -translate-x-1/2 rounded-full opacity-[0.22] blur-3xl" style={{ background: "radial-gradient(circle, #4f46e5, transparent 70%)" }} />

      <div className="relative z-10">
        <header className="mx-auto flex w-full max-w-[860px] items-center justify-between px-6 py-6">
          <Link href="/tools/buying-moment-check" className="flex items-center gap-2.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#818cf8", boxShadow: "0 0 12px #818cf8" }} aria-hidden />
            <span className="text-[16px] font-semibold" style={{ fontFamily: DISPLAY, letterSpacing: "-0.01em" }}>Buying Moment</span>
          </Link>
          <Link href="/for/saas?utm_source=tool&utm_medium=referral&utm_campaign=nav" className="text-[14px] font-semibold" style={{ color: "#a5adde" }}>
            How it works
          </Link>
        </header>

        <section className="mx-auto w-full max-w-[860px] px-6 pb-28 pt-10 sm:pt-16">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-[12.5px] font-semibold uppercase" style={{ fontFamily: MONO, color: "#38e0d4", letterSpacing: "0.16em" }}>
              Free · no signup to see it
            </p>
            <h1 className="mt-4 text-[clamp(2.2rem,5.4vw,3.6rem)] font-medium" style={{ fontFamily: DISPLAY, color: "#eef1ff", letterSpacing: "-0.03em", lineHeight: 1.03, textWrap: "balance" }}>
              See which companies need what you sell, <span style={{ color: "#818cf8" }}>right now.</span>
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-[17px] leading-relaxed" style={{ color: "#98a2c9" }}>
              Tell us what you sell. We show you a real company at a buying moment for it, and the public signals that prove
              it. Then we build five more, for your exact thing, free.
            </p>
          </div>

          <div className="mt-11">
            <Finder />
          </div>
        </section>
      </div>
    </main>
  );
}
