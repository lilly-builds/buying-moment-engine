"use client";

import { useState } from "react";
import Link from "next/link";
import { MOMENT_TEMPLATES, tidy } from "./moments";

/**
 * Free lead-magnet tool: the buying-moment playbook. The visitor says what they
 * sell and (optionally) who they sell to; they get an honest, instant playbook of
 * the public moments worth watching, plus a sample brief, then a CTA into one of
 * the three landing experiments (rotated per visitor for an even split, tagged
 * utm_source=tool so the signup attributes back to this channel).
 *
 * No fake scanning, no backend, no cost: the value is the curated playbook itself.
 */

const VARIANTS = ["saas", "outbound", "founders"] as const;

// Neutral brand palette for the shared top-of-funnel (indigo accent).
const C = {
  accent: "#4f46e5",
  ink: "#0b1020",
  inkMuted: "#5b6472",
  line: "#e6e8f2",
  card: "#f7f8fc",
  ground: "#ffffff",
  soft: "#eef1fe",
};
const DISPLAY = "var(--font-inter-tight), system-ui, sans-serif";
const BODY = "var(--font-inter), system-ui, sans-serif";
const MONO = "var(--font-ibm-plex-mono), ui-monospace, monospace";

function pickVariant(): (typeof VARIANTS)[number] {
  // Per-visitor rotation for an even-ish split across the three experiments.
  return VARIANTS[Math.floor(Math.random() * VARIANTS.length)];
}

export function PlaybookTool() {
  const [sell, setSell] = useState("");
  const [who, setWho] = useState("");
  const [result, setResult] = useState<null | { sell: string; who: string; variant: (typeof VARIANTS)[number] }>(null);

  function run(e: React.FormEvent) {
    e.preventDefault();
    const cleanSell = tidy(sell, "what you sell");
    const cleanWho = tidy(who, "your market");
    setResult({ sell: cleanSell, who: cleanWho, variant: pickVariant() });
    // move focus/scroll to results
    requestAnimationFrame(() => {
      document.getElementById("playbook-result")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  const ctaHref = result
    ? `/for/${result.variant}?utm_source=tool&utm_medium=referral&utm_campaign=playbook`
    : "/for/outbound";

  return (
    <div style={{ fontFamily: BODY, color: C.ink }}>
      {/* input */}
      <form onSubmit={run} className="rounded-2xl border p-6 sm:p-7" style={{ borderColor: C.line, background: C.card }}>
        <div className="flex flex-col gap-4">
          <div>
            <label htmlFor="sell" className="mb-1.5 block text-[14px] font-semibold" style={{ color: C.ink }}>
              What do you sell?
            </label>
            <input
              id="sell"
              value={sell}
              onChange={(e) => setSell(e.target.value)}
              placeholder="e.g. scheduling software for dental groups"
              maxLength={120}
              className="w-full rounded-xl border px-4 py-3 text-[15px] outline-none"
              style={{ borderColor: C.line, background: C.ground, color: C.ink }}
            />
          </div>
          <div>
            <label htmlFor="who" className="mb-1.5 block text-[14px] font-semibold" style={{ color: C.ink }}>
              Who do you sell to? <span style={{ color: C.inkMuted }}>(optional)</span>
            </label>
            <input
              id="who"
              value={who}
              onChange={(e) => setWho(e.target.value)}
              placeholder="e.g. multi-location dental groups"
              maxLength={120}
              className="w-full rounded-xl border px-4 py-3 text-[15px] outline-none"
              style={{ borderColor: C.line, background: C.ground, color: C.ink }}
            />
          </div>
          <button
            type="submit"
            className="rounded-xl px-5 py-3 text-[15px] font-semibold transition hover:opacity-90"
            style={{ background: C.accent, color: "#fff" }}
          >
            Show my playbook
          </button>
        </div>
      </form>

      {result && (
        <div id="playbook-result" className="mt-10 scroll-mt-6">
          <p className="text-[13px] font-semibold uppercase" style={{ fontFamily: MONO, color: C.accent, letterSpacing: "0.08em" }}>
            Your buying-moment playbook
          </p>
          <h2 className="mt-2 text-[clamp(1.5rem,3.5vw,2.2rem)] font-medium" style={{ fontFamily: DISPLAY, letterSpacing: "-0.02em", lineHeight: 1.1 }}>
            The moments that mean someone needs {result.sell}
          </h2>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed" style={{ color: C.inkMuted }}>
            These are the public signals worth watching. Each one is a company telling the world it is ready, if you are
            listening on the right day.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {MOMENT_TEMPLATES.map((m, i) => (
              <div key={m.title} className="rounded-2xl border p-5" style={{ borderColor: C.line, background: C.ground }}>
                <div className="flex items-center gap-2.5">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold" style={{ background: C.soft, color: C.accent, fontFamily: MONO }}>
                    {i + 1}
                  </span>
                  <h3 className="text-[17px] font-semibold" style={{ fontFamily: DISPLAY }}>{m.title}</h3>
                </div>
                <p className="mt-2.5 text-[14px] leading-relaxed" style={{ color: C.ink }}>{m.why(result.sell)}</p>
                <p className="mt-2.5 text-[12px]" style={{ fontFamily: MONO, color: C.inkMuted }}>
                  Shows up in: {m.where}
                </p>
              </div>
            ))}
          </div>

          {/* sample brief */}
          <div className="mt-10 overflow-hidden rounded-2xl" style={{ background: "#0a0f24" }}>
            <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: "rgba(255,255,255,0.12)" }}>
              <span className="text-[12px] font-semibold" style={{ fontFamily: MONO, color: "#9aa3c7", letterSpacing: "0.08em" }}>SAMPLE BRIEF</span>
              <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: C.accent, color: "#fff", fontFamily: MONO }}>NEW DECISION-MAKER</span>
            </div>
            <div className="px-6 py-6">
              <h3 className="text-[22px] font-semibold" style={{ fontFamily: DISPLAY, color: "#f4f6ff" }}>A company in {result.who}</h3>
              <p className="mt-3 text-[15px] leading-relaxed" style={{ color: "rgba(244,246,255,0.85)" }}>
                <span className="font-semibold" style={{ color: "#f4f6ff" }}>Why now: </span>
                They just brought in a new decision-maker, and the first 90 days are when the stack gets decided. That is the
                moment to reach them about {result.sell}, before they have settled on anyone else.
              </p>
              <p className="mt-4 text-[13px]" style={{ fontFamily: MONO, color: "#9aa3c7" }}>
                Subject: <span style={{ color: "#f4f6ff" }}>Congrats on the new role, one thing worth a look</span>
              </p>
              <p className="mt-3 text-[14px] leading-relaxed" style={{ color: "rgba(244,246,255,0.88)" }}>
                Every claim in the real thing links to the public source it came from, so you reach out informed, never
                guessing. This is a sample. Yours is built from your actual buyers.
              </p>
            </div>
          </div>

          {/* CTA */}
          <div className="mt-10 rounded-2xl border-2 p-7 text-center sm:p-8" style={{ borderColor: C.accent, background: C.soft }}>
            <h3 className="text-[clamp(1.3rem,3vw,1.8rem)] font-medium" style={{ fontFamily: DISPLAY, letterSpacing: "-0.02em", textWrap: "balance" }}>
              We watch every one of these for you, every morning.
            </h3>
            <p className="mx-auto mt-2 max-w-lg text-[15px]" style={{ color: C.inkMuted }}>
              Get your first 3 briefs free. No credit card, no setup, no API keys.
            </p>
            <Link
              href={ctaHref}
              className="mt-5 inline-block rounded-xl px-6 py-3 text-[15px] font-semibold transition hover:opacity-90"
              style={{ background: C.accent, color: "#fff" }}
            >
              Get my 3 free briefs
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
