import type { Metadata } from "next";
import Link from "next/link";
import { INDUSTRIES } from "./industries";

export const metadata: Metadata = {
  title: "Buying moments by industry — the public signals that mean they are ready",
  description:
    "Field guides to the public buying moments in each industry: the signals that mean a company is ready to buy, and how to reach them the moment they need you.",
  openGraph: { title: "Buying moments by industry", type: "website" },
};

const DISPLAY = "var(--font-inter-tight), system-ui, sans-serif";
const BODY = "var(--font-inter), system-ui, sans-serif";
const MONO = "var(--font-ibm-plex-mono), ui-monospace, monospace";

const C = { accent: "#4f46e5", ink: "#0b1020", inkMuted: "#5b6472", line: "#e6e8f2", card: "#f7f8fc", soft: "#eef1fe" };

export default function MomentsIndex() {
  return (
    <main style={{ background: "#ffffff", color: C.ink, minHeight: "100vh", fontFamily: BODY }}>
      <header className="mx-auto flex w-full max-w-[820px] items-center justify-between px-6 py-6">
        <Link href="/moments" className="flex items-center gap-2.5">
          <span className="inline-block h-3 w-3 rounded-full" style={{ background: C.accent }} aria-hidden />
          <span className="text-[17px] font-semibold" style={{ fontFamily: DISPLAY, letterSpacing: "-0.01em" }}>Buying Moment</span>
        </Link>
        <Link href="/tools/buying-moment-check" className="text-[14px] font-semibold" style={{ color: C.accent }}>Free playbook tool</Link>
      </header>

      <section className="mx-auto w-full max-w-[820px] px-6 pb-24 pt-4">
        <p className="text-[13px] font-semibold uppercase" style={{ fontFamily: MONO, color: C.accent, letterSpacing: "0.08em" }}>Field guides</p>
        <h1 className="mt-3 text-[clamp(2rem,5vw,3rem)] font-medium" style={{ fontFamily: DISPLAY, letterSpacing: "-0.025em", lineHeight: 1.06, textWrap: "balance" }}>
          Buying moments, by industry
        </h1>
        <p className="mt-4 max-w-2xl text-[17px] leading-relaxed" style={{ color: C.inkMuted }}>
          Every industry leaves a public trail the moment a company is ready to buy. Pick yours to see the exact signals worth
          watching, and how to reach them the moment they need you.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {INDUSTRIES.map((ind) => (
            <Link key={ind.slug} href={`/moments/${ind.slug}`} className="group rounded-2xl border p-6 transition hover:border-current" style={{ borderColor: C.line, background: C.card }}>
              <h2 className="text-[19px] font-semibold" style={{ fontFamily: DISPLAY, color: C.ink }}>{ind.h1}</h2>
              <p className="mt-2 text-[14px] leading-relaxed" style={{ color: C.inkMuted }}>{ind.moments.length} signals worth watching in {ind.label}.</p>
              <span className="mt-3 inline-block text-[14px] font-semibold" style={{ color: C.accent }}>Read the field guide →</span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
