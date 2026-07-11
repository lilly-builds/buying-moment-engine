"use client";

import { useEffect, useRef, useState } from "react";
import { pickExample, type ExampleLead } from "./examples";
import { tidy } from "./moments";

/**
 * The free finder tool, the top of funnel and the marketing channel in one.
 *
 * Flow: say what you sell -> a short, honest "reading the signals" beat -> ONE
 * fully-researched example lead, no signup, showing the three public signals
 * that stack into "in-market now" (that stacking is the product's edge, so it is
 * what we show) -> a low-friction email unlock -> a designed "your 5 are being
 * built" confirmation. The example is labelled as an example; the tailored 5-pack
 * is the real promise fulfilled after signup (the reverse trial).
 */

const VARIANTS = ["saas", "outbound", "founders"] as const;

const C = {
  accent: "#818cf8",
  accentStrong: "#6366f1",
  cyan: "#38e0d4",
  ink: "#eef1ff",
  muted: "#98a2c9",
  faint: "#6b74a0",
  panel: "rgba(255,255,255,0.035)",
  panelSolid: "#0e1224",
  line: "rgba(255,255,255,0.09)",
  lineSoft: "rgba(255,255,255,0.055)",
};
const DISPLAY = "var(--font-inter-tight), system-ui, sans-serif";
const BODY = "var(--font-inter), system-ui, sans-serif";
const MONO = "var(--font-ibm-plex-mono), ui-monospace, monospace";

const SCAN_SOURCES = ["job boards", "SEC filings", "product changelogs", "exec moves on LinkedIn", "review sites", "vendor sunset notices", "funding announcements"];

type Phase = "input" | "scanning" | "revealed" | "captured";

export function Finder() {
  const [sell, setSell] = useState("");
  const [phase, setPhase] = useState<Phase>("input");
  const [lead, setLead] = useState<ExampleLead | null>(null);
  const [scanIdx, setScanIdx] = useState(0);
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState(""); // honeypot
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const revealRef = useRef<HTMLDivElement | null>(null);
  const doneRef = useRef<HTMLDivElement | null>(null);
  const cleanSell = tidy(sell, "what you sell");

  // scanning beat: tick through sources, then reveal (animated path only; the
  // reduced-motion path skips straight to reveal in the submit handler)
  useEffect(() => {
    if (phase !== "scanning") return;
    const tick = setInterval(() => setScanIdx((i) => i + 1), 240);
    const done = setTimeout(() => {
      setLead(pickExample(cleanSell));
      setPhase("revealed");
    }, 1700);
    return () => {
      clearInterval(tick);
      clearTimeout(done);
    };
  }, [phase, cleanSell]);

  useEffect(() => {
    if (phase === "revealed") revealRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (phase === "captured") doneRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [phase]);

  function startScan(e: React.FormEvent) {
    e.preventDefault();
    if (!sell.trim()) return;
    // Respect reduced motion: skip the scan beat and reveal immediately.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setLead(pickExample(cleanSell));
      setPhase("revealed");
      return;
    }
    setScanIdx(0);
    setPhase("scanning");
  }

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    setErr("");
    try {
      const variant = VARIANTS[Math.floor(Math.random() * VARIANTS.length)];
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          whatYouSell: cleanSell,
          variant,
          company_website: company,
          utmSource: "tool",
          utmMedium: "referral",
          utmCampaign: "finder",
          referrer: typeof document !== "undefined" ? document.referrer || null : null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setErr(data.error ?? "Something went wrong. Try again.");
        setSending(false);
        return;
      }
      setPhase("captured");
    } catch {
      setErr("Network hiccup. Try again in a moment.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ fontFamily: BODY, color: C.ink }}>
      {/* ── input ─────────────────────────────────────────────── */}
      <form onSubmit={startScan} className="mx-auto max-w-xl">
        <label htmlFor="sell" className="mb-2 block text-center text-[13px] font-semibold uppercase" style={{ fontFamily: MONO, color: C.accent, letterSpacing: "0.14em" }}>
          What do you sell?
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id="sell"
            value={sell}
            onChange={(e) => setSell(e.target.value)}
            placeholder="e.g. a modern TMS platform for freight teams"
            maxLength={120}
            autoComplete="off"
            disabled={phase === "scanning"}
            className="finder-field w-full flex-1 rounded-xl px-4 py-3.5 text-[15px]"
          />
          <button
            type="submit"
            disabled={phase === "scanning" || !sell.trim()}
            className="shrink-0 rounded-xl px-6 py-3.5 text-[15px] font-semibold transition active:scale-[0.99] disabled:opacity-50"
            style={{ background: C.accentStrong, color: "#fff", boxShadow: `0 10px 30px -10px ${C.accentStrong}` }}
          >
            {phase === "scanning" ? "Reading signals..." : phase === "input" ? "Show me a live example" : "Run another"}
          </button>
        </div>
        <p className="mt-3 text-center text-[13px]" style={{ color: C.faint }}>
          No signup to see it. One real example, fully briefed.
        </p>
      </form>

      {/* ── scanning ──────────────────────────────────────────── */}
      {phase === "scanning" && (
        <div className="mx-auto mt-12 max-w-md text-center" aria-live="polite">
          <div className="relative mx-auto mb-5 h-1 w-full overflow-hidden rounded-full" style={{ background: C.lineSoft }}>
            <div className="finder-scanbar absolute inset-y-0 left-0 w-1/3 rounded-full" style={{ background: `linear-gradient(90deg, transparent, ${C.accent}, transparent)` }} />
          </div>
          <p className="text-[14px]" style={{ fontFamily: MONO, color: C.muted }}>
            reading{" "}
            <span style={{ color: C.cyan }}>{SCAN_SOURCES[scanIdx % SCAN_SOURCES.length]}</span>
            <span className="finder-blink">_</span>
          </p>
        </div>
      )}

      {/* ── revealed ──────────────────────────────────────────── */}
      {(phase === "revealed" || phase === "captured") && lead && (
        <div ref={revealRef} className="mt-12 scroll-mt-6">
          <p className="text-center text-[14px]" style={{ color: C.muted }}>
            Here is one, fully briefed.{" "}
            <span style={{ color: C.ink }}>Yours will be built for {cleanSell}.</span>
          </p>

          <Dossier lead={lead} />
        </div>
      )}

      {/* ── unlock ────────────────────────────────────────────── */}
      {phase === "revealed" && (
        <div className="mx-auto mt-8 max-w-xl rounded-2xl p-6 sm:p-7" style={{ background: `linear-gradient(180deg, ${C.panel}, transparent)`, border: `1px solid ${C.line}` }}>
          <h3 className="text-center text-[clamp(1.3rem,3vw,1.7rem)] font-medium" style={{ fontFamily: DISPLAY, color: C.ink, letterSpacing: "-0.02em", textWrap: "balance" }}>
            That is one. Get 5 built for {cleanSell}.
          </h3>
          <p className="mx-auto mt-2 max-w-md text-center text-[14px]" style={{ color: C.muted }}>
            Real companies, each with the signals, the person, and the first email. Free, sent within a day.
          </p>
          <form onSubmit={unlock} className="mx-auto mt-5 max-w-md">
            <div aria-hidden style={{ position: "absolute", left: "-9999px" }}>
              <label htmlFor="fx">Company website</label>
              <input id="fx" tabIndex={-1} autoComplete="off" value={company} onChange={(e) => setCompany(e.target.value)} />
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                className="finder-field w-full flex-1 rounded-xl px-4 py-3.5 text-[15px]"
              />
              <button type="submit" disabled={sending} className="shrink-0 rounded-xl px-6 py-3.5 text-[15px] font-semibold transition active:scale-[0.99] disabled:opacity-60" style={{ background: C.cyan, color: "#04201d", boxShadow: `0 10px 30px -10px ${C.cyan}` }}>
                {sending ? "Sending..." : "Send me my 5 briefs"}
              </button>
            </div>
            {err && <p className="mt-2 text-center text-[13px]" style={{ color: "#fb7185" }}>{err}</p>}
            <p className="mt-3 text-center text-[12px]" style={{ color: C.faint }}>No credit card. No setup. Unsubscribe in one click.</p>
          </form>
        </div>
      )}

      {/* ── captured ──────────────────────────────────────────── */}
      {phase === "captured" && (
        <div ref={doneRef} className="mx-auto mt-8 max-w-xl text-center">
          <div className="mx-auto mb-4 inline-flex h-11 w-11 items-center justify-center rounded-full text-[20px]" style={{ background: C.cyan, color: "#04201d" }} aria-hidden>✓</div>
          <h3 className="text-[clamp(1.4rem,3.4vw,2rem)] font-medium" style={{ fontFamily: DISPLAY, color: C.ink, letterSpacing: "-0.02em", textWrap: "balance" }}>
            On it. Your 5 briefs are being built.
          </h3>
          <p className="mx-auto mt-2 max-w-md text-[15px]" style={{ color: C.muted }}>
            We are researching companies that need {cleanSell} and will send them to{" "}
            <span style={{ color: C.ink }}>{email || "your inbox"}</span> within a day.
          </p>
          <div className="mt-7 flex flex-col gap-2.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl px-4 py-3 text-left" style={{ background: C.panel, border: `1px solid ${i === 0 ? C.line : C.lineSoft}` }}>
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold" style={{ background: i === 0 ? C.cyan : "rgba(255,255,255,0.06)", color: i === 0 ? "#04201d" : C.faint, fontFamily: MONO }}>{i + 1}</span>
                {i === 0 && lead ? (
                  <span className="text-[14px]" style={{ color: C.ink }}>{lead.company} <span style={{ color: C.faint }}>· briefed</span></span>
                ) : (
                  <span className="finder-shimmer text-[13px]" style={{ fontFamily: MONO, color: C.faint }}>researching a match for {cleanSell}...</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── the dossier: one researched lead ──────────────────────────── */

function Dossier({ lead }: { lead: ExampleLead }) {
  return (
    <div className="relative mx-auto mt-5 max-w-2xl overflow-hidden rounded-3xl" style={{ background: C.panelSolid, border: `1px solid ${C.line}`, boxShadow: "0 40px 100px -50px #000" }}>
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4 sm:px-7" style={{ borderColor: C.line }}>
        <span className="text-[11px] font-semibold" style={{ fontFamily: MONO, color: C.faint, letterSpacing: "0.12em" }}>EXAMPLE BRIEF</span>
        <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-bold" style={{ background: "rgba(56,224,212,0.12)", color: C.cyan, fontFamily: MONO, letterSpacing: "0.06em" }}>
          <span className="finder-pulse inline-block h-1.5 w-1.5 rounded-full" style={{ background: C.cyan }} />
          IN-MARKET NOW
        </span>
      </div>

      <div className="px-6 py-6 sm:px-7">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="text-[24px] font-semibold" style={{ fontFamily: DISPLAY, color: C.ink, letterSpacing: "-0.01em" }}>{lead.company}</h3>
          <p className="text-[12px]" style={{ fontFamily: MONO, color: C.faint }}>{lead.meta}</p>
        </div>
        <p className="mt-2 text-[16px] leading-snug" style={{ color: C.accent }}>{lead.headline}</p>

        {/* the three stacked signals */}
        <p className="mt-6 text-[11px] font-semibold uppercase" style={{ fontFamily: MONO, color: C.faint, letterSpacing: "0.12em" }}>3 signals we caught</p>
        <div className="relative mt-3 pl-6">
          {/* connector spine */}
          <span className="absolute left-[5px] top-2 bottom-8 w-px" style={{ background: `linear-gradient(${C.accent}, ${C.cyan})` }} aria-hidden />
          <div className="flex flex-col gap-4">
            {lead.signals.map((s) => (
              <div key={s.label} className="relative">
                <span className="absolute -left-6 top-1.5 h-2.5 w-2.5 rounded-full" style={{ background: C.accent, boxShadow: `0 0 0 3px ${C.panelSolid}, 0 0 12px ${C.accent}` }} aria-hidden />
                <p className="text-[14px]" style={{ color: C.ink }}>
                  <span className="font-semibold" style={{ color: C.accent }}>{s.label}. </span>
                  {s.detail}
                </p>
                <p className="mt-0.5 text-[11.5px]" style={{ fontFamily: MONO, color: C.faint }}>◆ {s.source} · {s.when}</p>
              </div>
            ))}
          </div>
          {/* merge into verdict */}
          <div className="relative mt-4">
            <span className="absolute -left-[22px] top-1.5 h-3 w-3 rounded-full" style={{ background: C.cyan, boxShadow: `0 0 0 3px ${C.panelSolid}, 0 0 14px ${C.cyan}` }} aria-hidden />
            <p className="text-[13px] font-semibold" style={{ fontFamily: MONO, color: C.cyan, letterSpacing: "0.04em" }}>= STACKED = IN-MARKET</p>
          </div>
        </div>

        {/* why now */}
        <div className="mt-6 rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.lineSoft}` }}>
          <p className="text-[14px] leading-relaxed" style={{ color: "rgba(238,241,255,0.86)" }}>
            <span className="font-semibold" style={{ color: C.ink }}>Why now: </span>{lead.whyNow}
          </p>
        </div>

        {/* the email, ready */}
        <div className="mt-4 rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.lineSoft}` }}>
          <div className="mb-2 flex items-center justify-between border-b pb-2" style={{ borderColor: C.lineSoft }}>
            <div>
              <p className="text-[13px] font-semibold" style={{ color: C.ink }}>{lead.contact.name}</p>
              <p className="text-[11px]" style={{ color: C.faint }}>{lead.contact.title}</p>
            </div>
            <span className="rounded-md px-2 py-1 text-[10px] font-bold" style={{ background: C.accentStrong, color: "#fff", fontFamily: MONO }}>DRAFT READY</span>
          </div>
          <p className="text-[12px]" style={{ fontFamily: MONO, color: C.faint }}>Subject: <span style={{ color: C.ink }}>{lead.email.subject}</span></p>
          <p className="mt-2 text-[13.5px] leading-relaxed" style={{ color: "rgba(238,241,255,0.8)" }}>{lead.email.preview}</p>
        </div>
      </div>
    </div>
  );
}
