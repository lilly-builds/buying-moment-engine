"use client";

import { useState } from "react";
import type { VariantKey } from "./variants";
import { getUtm } from "./analytics";

interface Props {
  variant: VariantKey;
  ctaLabel: string;
  ctaSub: string;
  sellPlaceholder: string;
  /** Distinguishes the two mounts (hero vs final) so ids stay unique. */
  place: "hero" | "final";
}

type Status = "idle" | "loading" | "done" | "error";

/**
 * Public "get my 3 free briefs" form. Renders inside a landing theme root, so it
 * reads colors from the ambient CSS vars (--accent, --ink, ...). Fields carry the
 * .bm-field class (base + focus styles live in app/for/layout.tsx). Posts to the
 * public /api/waitlist route with the variant + UTM so the lead is attributed.
 */
export function SignupForm({ variant, ctaLabel, ctaSub, sellPlaceholder, place }: Props) {
  const [email, setEmail] = useState("");
  const [whatYouSell, setWhatYouSell] = useState("");
  const [company, setCompany] = useState(""); // honeypot, must stay empty
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "loading") return;
    setStatus("loading");
    setError("");
    try {
      const utm = getUtm();
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          whatYouSell: whatYouSell || null,
          variant,
          company_website: company, // honeypot
          referrer: typeof document !== "undefined" ? document.referrer || null : null,
          ...utm,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setStatus("error");
        setError(data.error ?? "Something went wrong. Try again.");
        return;
      }
      setStatus("done");
    } catch {
      setStatus("error");
      setError("Network hiccup. Try again in a moment.");
    }
  }

  if (status === "done") {
    return (
      <div role="status" className="rounded-2xl border p-6 text-left" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
        <div
          className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-full text-base font-semibold"
          style={{ background: "var(--accent)", color: "var(--on-accent)" }}
          aria-hidden
        >
          ✓
        </div>
        <p className="text-lg font-semibold" style={{ color: "var(--ink)" }}>
          {"You're on the list."}
        </p>
        <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--ink-muted)" }}>
          {"We'll email "}
          <span style={{ color: "var(--ink)" }}>{email}</span>
          {" the moment your first 3 briefs are ready. Watch for us within a day."}
        </p>
      </div>
    );
  }

  const idBase = `${place}-${variant}`;

  return (
    <form onSubmit={submit} className="w-full text-left" noValidate>
      {/* Honeypot: hidden from humans, catnip for bots. */}
      <div aria-hidden className="overflow-hidden" style={{ position: "absolute", left: "-9999px", height: 0, width: 0 }}>
        <label htmlFor={`${idBase}-company_website`}>Company website</label>
        <input
          id={`${idBase}-company_website`}
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2.5">
        <label htmlFor={`${idBase}-sell`} className="sr-only">
          What do you sell?
        </label>
        <input
          id={`${idBase}-sell`}
          type="text"
          value={whatYouSell}
          onChange={(e) => setWhatYouSell(e.target.value)}
          placeholder={sellPlaceholder}
          maxLength={280}
          className="bm-field w-full rounded-xl px-4 py-3 text-[15px]"
        />
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <label htmlFor={`${idBase}-email`} className="sr-only">
            Work email
          </label>
          <input
            id={`${idBase}-email`}
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            autoComplete="email"
            className="bm-field w-full flex-1 rounded-xl px-4 py-3 text-[15px]"
          />
          <button
            type="submit"
            disabled={status === "loading"}
            className="shrink-0 rounded-xl px-5 py-3 text-[15px] font-semibold transition active:scale-[0.99] disabled:opacity-70"
            style={{ background: "var(--accent)", color: "var(--on-accent)" }}
          >
            {status === "loading" ? "Saving..." : ctaLabel}
          </button>
        </div>
      </div>

      {status === "error" && (
        <p className="mt-2 text-sm" style={{ color: "#dc2626" }}>
          {error}
        </p>
      )}
      <p className="mt-2.5 text-[13px]" style={{ color: "var(--ink-muted)" }}>
        {ctaSub}
      </p>
    </form>
  );
}
