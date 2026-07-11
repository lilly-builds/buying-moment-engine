"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { brandVars } from "@/design/brand";
import { Button, Card, Input, Textarea } from "@/design/components";
import { cn } from "@/design/lib/cn";
import { joinClaimMetric } from "@/src/adapt/proof-format";
import type { WorkspaceConfig } from "@/src/workspace/schema";

/**
 * The Adapt-It onboarding — the showpiece (Phase 3). A calm, one-thing-per-screen
 * flow on the health-hero background. The Adapter (Claude) proposes; the human
 * confirms or nudges. Beats: welcome -> who you are -> who you sell to -> the
 * buying moment -> your proof -> make it yours -> reveal.
 *
 * The AI does the heavy lifting: after step 1 we call /api/adapt/generate and hold
 * the returned draft in state; every later screen edits that draft. The reveal
 * posts it to /api/adapt/finalize, which persists the workspace + sets it active,
 * then we hard-navigate to `/` so the dashboard renders their brand + feed.
 *
 * Motion is restrained and reduced-motion aware (Tailwind `motion-reduce:*` +
 * the globals reduced-motion guard on `.animate-card-glide-in`).
 */

type Draft = Omit<WorkspaceConfig, "sampleFeed">;
type Brand = WorkspaceConfig["brand"];

type Step = "welcome" | "who" | "sellTo" | "moments" | "proof" | "brand" | "reveal";

const WORKING_STEPS: Step[] = ["who", "sellTo", "moments", "proof", "brand"];

/** The Adapter's reassuring, rotating lines while it studies the business. */
const STUDYING_LINES = [
  "The Adapter is studying your business...",
  "Finding the moments that predict a buy...",
  "Shaping your pitch and your proof...",
  "Choosing a brand that fits your world...",
  "Almost there, tidying the details...",
];

/** The felt-progress phases during the final reveal. */
const REVEAL_PHASES = [
  "Reading your answers",
  "Wiring up your signals",
  "Writing your first briefs",
  "Painting your brand",
  "Bringing it all together",
];

const BRAND_PRESETS: { name: string; brand: Pick<Brand, "primaryColor" | "accentColor" | "heroFrom" | "heroTo"> }[] = [
  { name: "Ocean", brand: { primaryColor: "#2f5fe0", accentColor: "#0e9f6e", heroFrom: "#1e3a8a", heroTo: "#93c5fd" } },
  { name: "Teal", brand: { primaryColor: "#0d9488", accentColor: "#2563eb", heroFrom: "#0f766e", heroTo: "#99f6e4" } },
  { name: "Indigo", brand: { primaryColor: "#4f46e5", accentColor: "#0ea5e9", heroFrom: "#3730a3", heroTo: "#a5b4fc" } },
  { name: "Forest", brand: { primaryColor: "#059669", accentColor: "#0891b2", heroFrom: "#047857", heroTo: "#6ee7b7" } },
  { name: "Amber", brand: { primaryColor: "#ea580c", accentColor: "#0891b2", heroFrom: "#9a3412", heroTo: "#fdba74" } },
  { name: "Rose", brand: { primaryColor: "#e11d48", accentColor: "#7c3aed", heroFrom: "#9f1239", heroTo: "#fda4af" } },
];

const HEX = /^#[0-9a-f]{6}$/i;

/** Lighten a hex toward white by `amount` in [0, 1] — for a custom hero stop. */
function lighten(hex: string, amount: number): string {
  if (!HEX.test(hex)) return hex;
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const hx = (c: number) => mix(c).toString(16).padStart(2, "0");
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

function isHttpUrl(value: string): boolean {
  const v = value.trim();
  if (!/^https?:\/\//i.test(v)) return false;
  try {
    new URL(v);
    return true;
  } catch {
    return false;
  }
}

// ─── Small building blocks ────────────────────────────────────────────────────

/** A calm animated orb using the brand `.gradient-orb`, with a soft breathing glow. */
function AdapterOrb({ size = "lg" }: { size?: "sm" | "lg" }) {
  const disc = size === "lg" ? "h-24 w-24" : "h-14 w-14";
  const glow = size === "lg" ? "h-40 w-40" : "h-24 w-24";
  return (
    <div className="relative flex items-center justify-center">
      <div
        aria-hidden
        className={cn(
          "absolute rounded-full gradient-orb opacity-60 blur-2xl animate-pulse [animation-duration:5s] motion-reduce:animate-none",
          glow,
        )}
      />
      <div aria-hidden className={cn("relative rounded-full gradient-orb shadow-card", disc)} />
    </div>
  );
}

function ProgressRail({ step }: { step: Step }) {
  const idx = WORKING_STEPS.indexOf(step);
  if (idx < 0) return null;
  const pct = ((idx + 1) / WORKING_STEPS.length) * 100;
  return (
    <div className="mb-8 flex flex-col gap-2">
      <div className="h-1 w-full overflow-hidden rounded-pill bg-surface-subtle">
        <div
          className="h-full rounded-pill gradient-brand transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="font-mono text-xs uppercase tracking-eyebrow text-ink-faint">
        Step {idx + 1} of {WORKING_STEPS.length}
      </p>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-sans text-sm font-medium text-ink">{label}</span>
      {children}
      {hint ? <span className="font-sans text-xs text-ink-faint">{hint}</span> : null}
    </label>
  );
}

// ─── The flow ─────────────────────────────────────────────────────────────────

export function AdaptFlow() {
  const [step, setStep] = useState<Step>("welcome");

  // Step 1 inputs.
  const [companyName, setCompanyName] = useState("");
  const [whatYouSell, setWhatYouSell] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");

  // The AI draft, held + edited across the flow.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patchDraft = useCallback((patch: Partial<Draft>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const patchBrand = useCallback((patch: Partial<Brand>) => {
    setDraft((prev) => (prev ? { ...prev, brand: { ...prev.brand, ...patch } } : prev));
  }, []);

  // Call the Adapter for the draft config, then move to "who you sell to".
  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/adapt/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyName, whatYouSell, websiteUrl: websiteUrl || null }),
      });
      const data = (await res.json()) as { config?: Draft; error?: string };
      if (!res.ok || !data.config) {
        throw new Error(data.error ?? "Generation failed");
      }
      setDraft(data.config);
      setStep("sellTo");
    } catch {
      setError("Something hiccuped while reading your business. Let's try that again.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <main className="gradient-hero relative flex min-h-full flex-1 flex-col items-center justify-center px-6 py-12">
      {/* `max-w-2xl` is the ceiling; each step centers its own narrower card
          (WorkingCard sets max-w-xl / max-w-2xl and mx-auto) within it, so the
          wide steps (moments, brand) can actually breathe past the narrow ones. */}
      <div key={step} className="w-full max-w-2xl animate-card-glide-in">
        {step === "welcome" && <Welcome onStart={() => setStep("who")} />}

        {step === "who" && (
          <WorkingCard step={step}>
            <WhoStep
              companyName={companyName}
              whatYouSell={whatYouSell}
              websiteUrl={websiteUrl}
              setCompanyName={setCompanyName}
              setWhatYouSell={setWhatYouSell}
              setWebsiteUrl={setWebsiteUrl}
              generating={generating}
              error={error}
              onNext={generate}
            />
          </WorkingCard>
        )}

        {step === "sellTo" && draft && (
          <WorkingCard step={step}>
            <SellToStep
              draft={draft}
              patchDraft={patchDraft}
              onBack={() => setStep("who")}
              onNext={() => setStep("moments")}
            />
          </WorkingCard>
        )}

        {step === "moments" && draft && (
          <WorkingCard step={step} wide>
            <MomentsStep
              draft={draft}
              patchDraft={patchDraft}
              onBack={() => setStep("sellTo")}
              onNext={() => setStep("proof")}
            />
          </WorkingCard>
        )}

        {step === "proof" && draft && (
          <WorkingCard step={step}>
            <ProofStep
              draft={draft}
              patchDraft={patchDraft}
              onBack={() => setStep("moments")}
              onNext={() => setStep("brand")}
            />
          </WorkingCard>
        )}

        {step === "brand" && draft && (
          <WorkingCard step={step} wide>
            <BrandStep
              draft={draft}
              patchBrand={patchBrand}
              onBack={() => setStep("proof")}
              onNext={() => setStep("reveal")}
            />
          </WorkingCard>
        )}

        {step === "reveal" && draft && <RevealStep draft={draft} onBack={() => setStep("brand")} />}
      </div>
    </main>
  );
}

/** The card chrome the working steps share: the progress rail + a white surface. */
function WorkingCard({
  step,
  wide,
  children,
}: {
  step: Step;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full", wide ? "max-w-2xl" : "max-w-xl")}>
      <Card variant="elevated" padding="lg">
        <ProgressRail step={step} />
        {children}
      </Card>
    </div>
  );
}

// ─── Welcome ──────────────────────────────────────────────────────────────────

function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-col items-center gap-8 text-center">
      <AdapterOrb />
      <div className="flex flex-col gap-3">
        <p className="font-mono text-xs uppercase tracking-eyebrow text-white/80">The Adapter</p>
        <h1 className="font-display text-h2 font-book tracking-brand text-balance text-white">
          Let&apos;s adapt this engine to your business.
        </h1>
        <p className="mx-auto max-w-md font-sans text-lg text-white/80">
          Answer a few quick questions and I&apos;ll reshape everything to you: your buying moments,
          your pitch, your proof, your brand. It takes about two minutes.
        </p>
      </div>
      <Button variant="primary-dark" size="lg" onClick={onStart}>
        Start
      </Button>
      <a
        href="/adapt/chat"
        className="rounded-control font-sans text-sm text-white/80 underline-offset-4 hover:text-white hover:underline"
      >
        Rather talk it through?
      </a>
    </div>
  );
}

// ─── Step 1: who you are ──────────────────────────────────────────────────────

function WhoStep({
  companyName,
  whatYouSell,
  websiteUrl,
  setCompanyName,
  setWhatYouSell,
  setWebsiteUrl,
  generating,
  error,
  onNext,
}: {
  companyName: string;
  whatYouSell: string;
  websiteUrl: string;
  setCompanyName: (v: string) => void;
  setWhatYouSell: (v: string) => void;
  setWebsiteUrl: (v: string) => void;
  generating: boolean;
  error: string | null;
  onNext: () => void;
}) {
  const ready = companyName.trim().length > 0 && whatYouSell.trim().length > 0;

  if (generating) {
    return <StudyingState />;
  }

  return (
    <div className="flex flex-col gap-6">
      <Header title="Who are you?" subtitle="Two lines is plenty. I'll take it from there." />
      <div className="flex flex-col gap-4">
        <Field label="Company name">
          <Input
            autoFocus
            maxLength={80}
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Northwind Logistics"
          />
        </Field>
        <Field label="What do you sell?" hint="One line is fine.">
          <Textarea
            rows={2}
            value={whatYouSell}
            onChange={(e) => setWhatYouSell(e.target.value)}
            placeholder="Route-planning software for mid-market freight carriers."
          />
        </Field>
        <Field label="Website" hint="Optional. It gives me a little more context.">
          <Input
            type="url"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="https://yourcompany.com"
          />
        </Field>
      </div>
      {error ? <p className="font-sans text-sm text-danger">{error}</p> : null}
      <div className="flex justify-end">
        <Button variant="primary" onClick={onNext} disabled={!ready}>
          Next
        </Button>
      </div>
    </div>
  );
}

/** The honest, warm loading state while the Adapter studies the business. */
function StudyingState() {
  const [line, setLine] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      setLine((n) => (n + 1) % STUDYING_LINES.length);
    }, 4200);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="flex flex-col items-center gap-6 py-8 text-center">
      <AdapterOrb size="sm" />
      <p className="min-h-6 font-sans text-lg text-ink transition-opacity duration-300">
        {STUDYING_LINES[line]}
      </p>
      <p className="font-sans text-sm text-ink-faint">This usually takes about half a minute.</p>
    </div>
  );
}

// ─── Step 2: who you sell to ──────────────────────────────────────────────────

function SellToStep({
  draft,
  patchDraft,
  onBack,
  onNext,
}: {
  draft: Draft;
  patchDraft: (patch: Partial<Draft>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const roles = draft.business.decisionMakerRoles.join(", ");

  function commitRoles(value: string) {
    const parsed = value
      .split(",")
      .map((r) => r.trim().slice(0, 80)) // each role's schema cap
      .filter((r) => r.length > 0)
      .slice(0, 20);
    patchDraft({
      business: {
        ...draft.business,
        decisionMakerRoles: parsed.length > 0 ? parsed : draft.business.decisionMakerRoles,
      },
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Header
        title="Here's who I think you sell to."
        subtitle="Nudge anything that's off. A quick read is all I need."
      />
      <div className="flex flex-col gap-4">
        <Field label="Your ideal customer">
          <Textarea
            rows={3}
            maxLength={500}
            value={draft.business.icp}
            onChange={(e) =>
              patchDraft({ business: { ...draft.business, icp: e.target.value } })
            }
          />
        </Field>
        <Field label="Who signs off" hint="Comma separated.">
          {/* Textarea, not Input: several roles wrap instead of clipping to
              "...Chief Hu" on a single line (matches "Your ideal customer" above). */}
          <Textarea
            rows={2}
            defaultValue={roles}
            maxLength={400}
            onBlur={(e) => commitRoles(e.target.value)}
          />
        </Field>
        <Field label="Where your customers are">
          {/* Textarea so a long geography list shows in full rather than clipping
              to "...markets fi". */}
          <Textarea
            rows={2}
            maxLength={200}
            value={draft.business.geography}
            onChange={(e) =>
              patchDraft({ business: { ...draft.business, geography: e.target.value } })
            }
          />
        </Field>
      </div>
      <NavRow onBack={onBack} onNext={onNext} nextLabel="Looks right" />
    </div>
  );
}

// ─── Step 3: the buying moment (the heart) ────────────────────────────────────

function MomentsStep({
  draft,
  patchDraft,
  onBack,
  onNext,
}: {
  draft: Draft;
  patchDraft: (patch: Partial<Draft>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const signals = draft.signals;

  function updateSignal(i: number, patch: Partial<Draft["signals"][number]>) {
    patchDraft({ signals: signals.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  }

  function removeSignal(i: number) {
    patchDraft({ signals: signals.filter((_, j) => j !== i) });
  }

  function addSignal() {
    patchDraft({
      signals: [
        ...signals,
        {
          name: "",
          kind: "custom",
          why: "",
          dataSource: "Public sources",
          freshnessDays: 30,
        },
      ],
    });
  }

  const allValid = signals.length > 0 && signals.every((s) => s.name.trim() && s.why.trim());

  return (
    <div className="flex flex-col gap-6">
      <Header
        title="These are the moments we'll watch for."
        subtitle="This is the heart of it: the signals that a company is about to buy. Keep them, reword them, or add your own."
      />
      <div className="flex flex-col gap-4">
        {signals.map((signal, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-panel border border-line-soft bg-surface-card p-4">
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-pill gradient-brand font-mono text-xs font-medium text-white"
              >
                {i + 1}
              </span>
              <Input
                maxLength={120}
                value={signal.name}
                onChange={(e) => updateSignal(i, { name: e.target.value })}
                placeholder="Name this buying moment"
                className="font-medium"
              />
              {signals.length > 1 ? (
                <Button variant="tertiary" size="sm" onClick={() => removeSignal(i)}>
                  Remove
                </Button>
              ) : null}
            </div>
            <Textarea
              rows={2}
              maxLength={500}
              value={signal.why}
              onChange={(e) => updateSignal(i, { why: e.target.value })}
              placeholder="Why does this predict a buy?"
              className="text-sm"
            />
          </div>
        ))}
        {signals.length < 6 ? (
          <Button variant="secondary" size="sm" onClick={addSignal} className="w-fit">
            Add a moment
          </Button>
        ) : null}
      </div>
      {!allValid ? (
        <p className="font-sans text-xs text-ink-faint">
          Give each moment a name and a reason so it can earn its place.
        </p>
      ) : null}
      <NavRow onBack={onBack} onNext={onNext} nextLabel="These are the ones" disabled={!allValid} />
    </div>
  );
}

// ─── Step 4: your proof ───────────────────────────────────────────────────────

function ProofStep({
  draft,
  patchDraft,
  onBack,
  onNext,
}: {
  draft: Draft;
  patchDraft: (patch: Partial<Draft>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const first = draft.proof[0];
  const [claim, setClaim] = useState(first ? first.claim : "");
  const [metric, setMetric] = useState(first && "metric" in first ? first.metric : "");
  const [url, setUrl] = useState(first && "sourceUrl" in first ? first.sourceUrl : "");

  function buildProof(): Draft["proof"] {
    const c = claim.trim();
    if (c.length === 0) return [];
    const m = metric.trim();
    if (m.length > 0 && isHttpUrl(url)) {
      return [{ claim: c.slice(0, 300), metric: m.slice(0, 200), sourceUrl: url.trim() }];
    }
    // `joinClaimMetric` trims a trailing "." / ":" off the claim so a result that
    // ends in a period never reads "...company.: 40% faster ramp".
    const combined = joinClaimMetric(c, m);
    return [{ claim: combined.slice(0, 300), tag: "pending" }];
  }

  function advanceWith(proof: Draft["proof"]) {
    patchDraft({ proof });
    onNext();
  }

  return (
    <div className="flex flex-col gap-6">
      <Header
        title="What's your best proof?"
        subtitle="One result a buyer would care about. If you have a link, even better. No result yet? Add it later."
      />
      <div className="flex flex-col gap-4">
        <Field label="The result">
          <Input
            value={claim}
            onChange={(e) => setClaim(e.target.value)}
            placeholder="Cut a carrier's fuel spend"
          />
        </Field>
        <Field label="The number" hint="Optional.">
          <Input
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            placeholder="12% in 90 days"
          />
        </Field>
        <Field label="A link" hint="Optional. A case study or page that backs it up.">
          <Input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://yourcompany.com/case-study"
          />
        </Field>
      </div>
      <div className="flex items-center justify-between gap-4">
        <Button variant="tertiary" size="sm" onClick={onBack}>
          Back
        </Button>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="md" onClick={() => advanceWith([])}>
            I&apos;ll add this later
          </Button>
          <Button variant="primary" size="md" onClick={() => advanceWith(buildProof())}>
            Use this
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Step 5: make it yours ────────────────────────────────────────────────────

function BrandStep({
  draft,
  patchBrand,
  onBack,
  onNext,
}: {
  draft: Draft;
  patchBrand: (patch: Partial<Brand>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const brand = draft.brand;
  const firstSignal = draft.signals[0]?.name ?? "Buying moment";

  function applyCustom(color: string) {
    if (!HEX.test(color)) return;
    patchBrand({
      primaryColor: color,
      heroFrom: color,
      heroTo: lighten(color, 0.6),
    });
  }

  const activePreset = BRAND_PRESETS.find((p) => p.brand.primaryColor === brand.primaryColor);

  return (
    <div className="flex flex-col gap-6">
      <Header title="Make it yours." subtitle="Pick a name and a look. Watch it change as you go." />

      <Field label="Product name">
        <Input
          maxLength={40}
          value={brand.productName}
          onChange={(e) => patchBrand({ productName: e.target.value, logoText: e.target.value })}
        />
      </Field>

      <div className="flex flex-col gap-3">
        <span className="font-sans text-sm font-medium text-ink">Color</span>
        <div className="flex flex-wrap items-center gap-2.5">
          {BRAND_PRESETS.map((preset) => {
            const selected = activePreset?.name === preset.name;
            return (
              <button
                key={preset.name}
                type="button"
                aria-label={preset.name}
                aria-pressed={selected}
                onClick={() => patchBrand(preset.brand)}
                className={cn(
                  "h-9 w-9 rounded-pill transition-transform duration-150 motion-reduce:transition-none",
                  selected ? "ring-2 ring-ink ring-offset-2" : "hover:scale-110",
                )}
                style={{
                  backgroundImage: `linear-gradient(135deg, ${preset.brand.primaryColor}, ${preset.brand.accentColor})`,
                }}
              />
            );
          })}
          <label
            className="flex h-9 cursor-pointer items-center gap-2 rounded-pill border border-line px-3 font-sans text-sm text-ink-body hover:border-line-cool"
            title="Pick a custom color"
          >
            <span
              aria-hidden
              className="h-4 w-4 rounded-pill border border-line"
              style={{ backgroundColor: brand.primaryColor }}
            />
            Custom
            <input
              type="color"
              value={HEX.test(brand.primaryColor) ? brand.primaryColor : "#2f5fe0"}
              onChange={(e) => applyCustom(e.target.value)}
              className="sr-only"
            />
          </label>
        </div>
      </div>

      <BrandPreview brand={brand} companyName={brand.companyName} signalName={firstSignal} />

      <NavRow onBack={onBack} onNext={onNext} nextLabel="Adapt my engine" />
    </div>
  );
}

/** The live preview: a mini nav + a sample card, re-skinned in real time. */
function BrandPreview({
  brand,
  companyName,
  signalName,
}: {
  brand: Brand;
  companyName: string;
  signalName: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-xs uppercase tracking-eyebrow text-ink-faint">Live preview</span>
      <div
        style={brandVars(brand)}
        className="overflow-hidden rounded-card border border-line shadow-card"
      >
        <div className="gradient-hero flex items-center gap-2.5 px-5 py-3.5">
          <span className="font-display text-base font-book tracking-brand text-white">
            {companyName || "Your company"}
          </span>
          <span className="rounded-pill bg-white/15 px-2.5 py-1 font-mono text-xs font-medium uppercase leading-none text-white">
            {brand.productName || "Product"}
          </span>
        </div>
        <div className="flex flex-col gap-3 bg-surface-card p-5">
          <span className="w-fit rounded-pill gradient-signal-staffing-spike px-4 py-1.5 font-sans text-xs leading-none text-white">
            {signalName}
          </span>
          <p className="font-display text-h5 font-book tracking-brand text-ink">
            A prospect just hit a buying moment.
          </p>
          <div>
            <Button variant="primary" size="sm">
              Open brief
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Reveal ───────────────────────────────────────────────────────────────────

type RevealStatus = "running" | "done" | "error";

function RevealStep({ draft, onBack }: { draft: Draft; onBack: () => void }) {
  const [phase, setPhase] = useState(0);
  const [pct, setPct] = useState(6);
  const [status, setStatus] = useState<RevealStatus>("running");
  const fetched = useRef(false);

  // One-shot finalize. The ref guard keeps it to a single call even under React
  // StrictMode's double-invoked effects.
  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    (async () => {
      try {
        const res = await fetch("/api/adapt/finalize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ config: draft }),
        });
        const data = (await res.json()) as { slug?: string; error?: string };
        if (!res.ok || !data.slug) throw new Error(data.error ?? "Finalize failed");
        setStatus("done");
      } catch {
        setStatus("error");
      }
    })();
  }, [draft]);

  // Felt progress: creep toward ~92% while the call runs. Set up/torn down
  // cleanly each render, so StrictMode never leaves the bar frozen.
  useEffect(() => {
    if (status !== "running") return;
    const id = window.setInterval(() => {
      setPct((p) => (p < 92 ? p + Math.max(0.6, (92 - p) * 0.03) : p));
      setPhase((n) =>
        n < REVEAL_PHASES.length - 1
          ? Math.min(REVEAL_PHASES.length - 1, n + (Math.random() < 0.2 ? 1 : 0))
          : n,
      );
    }, 500);
    return () => window.clearInterval(id);
  }, [status]);

  // On success: hold a beat so the finished bar is felt, then hard-navigate so
  // the dashboard picks up the freshly-set active-workspace cookie. The finished
  // bar/phase are DERIVED below (not set in this effect) so there is no cascading
  // setState — the effect only schedules the navigation.
  useEffect(() => {
    if (status !== "done") return;
    const t = window.setTimeout(() => {
      window.location.href = "/";
    }, 700);
    return () => window.clearTimeout(t);
  }, [status]);

  const shownPct = status === "done" ? 100 : pct;
  const shownPhase = status === "done" ? REVEAL_PHASES.length - 1 : phase;

  if (status === "error") {
    return (
      <div className="mx-auto w-full max-w-xl">
        <Card variant="elevated" padding="lg">
          <div className="flex flex-col items-center gap-5 py-6 text-center">
            <p className="font-sans text-lg text-ink">
              We couldn&apos;t finish adapting your engine. Let&apos;s try that once more.
            </p>
            <Button variant="primary" onClick={onBack}>
              Back to my brand
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-8 text-center">
      <AdapterOrb />
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-h2 font-book tracking-brand text-white">
          Adapting your engine...
        </h1>
        <p className="min-h-6 font-sans text-lg text-white/80 transition-opacity duration-300">
          {REVEAL_PHASES[shownPhase]}
        </p>
      </div>
      <div className="w-full max-w-sm">
        <div className="h-1.5 w-full overflow-hidden rounded-pill bg-white/20">
          <div
            className="h-full rounded-pill bg-white transition-[width] duration-500 ease-out motion-reduce:transition-none"
            style={{ width: `${shownPct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Shared bits ──────────────────────────────────────────────────────────────

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-display text-h4 font-book tracking-brand text-balance text-ink">{title}</h2>
      <p className="font-sans text-base text-ink-body text-pretty">{subtitle}</p>
    </div>
  );
}

function NavRow({
  onBack,
  onNext,
  nextLabel,
  disabled,
}: {
  onBack: () => void;
  onNext: () => void;
  nextLabel: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Button variant="tertiary" size="sm" onClick={onBack}>
        Back
      </Button>
      <Button variant="primary" size="md" onClick={onNext} disabled={disabled}>
        {nextLabel}
      </Button>
    </div>
  );
}
