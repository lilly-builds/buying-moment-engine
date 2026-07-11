"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { brandVars } from "@/design/brand";
import {
  Badge,
  Button,
  Card,
  Input,
  PageContainer,
  SectionHeader,
  Textarea,
  TopNav,
} from "@/design/components";
import { WorkspaceConfigSchema, type WorkspaceConfig } from "@/src/workspace/schema";
import {
  applySignalRenamesToSampleFeed,
  buildSignalRenameMap,
} from "@/src/workspace/signal-rename";

/**
 * The Customization Studio (Adapt-It P4) — the "super easy to customize to a high
 * extent" surface. A single-column editor with anchored sections for every lever
 * the Adapter set: Brand, Buying-moment signals, Pitch, Proof, and Audience.
 *
 * It holds the WHOLE active config in state (including the untouched sampleFeed) and
 * posts all of it to `POST /api/workspace/update`, which validates it against
 * `WorkspaceConfigSchema` and replaces the stored config. On success the router
 * refreshes so the layout re-resolves the workspace and the whole app re-skins;
 * the Brand section's live preview re-skins optimistically as you type, before you
 * save (north star law 3: show, don't tell).
 *
 * One primary action, "Save changes", pinned in a sticky bar — never two primaries
 * (north star law 1). Save is disabled while the config is invalid, with a plain
 * note saying what still needs a value, so a click can't dead-end on a 422.
 */

type Config = WorkspaceConfig;
type Brand = Config["brand"];
type Business = Config["business"];
type Signal = Config["signals"][number];
type Objection = Config["pitch"]["objections"][number];
type ProofPoint = Config["proof"][number];

const HEX = /^#[0-9a-f]{6}$/i;

interface Section {
  id: string;
  label: string;
}

const SECTIONS: Section[] = [
  { id: "brand", label: "Brand" },
  { id: "signals", label: "Signals" },
  { id: "pitch", label: "Pitch" },
  { id: "proof", label: "Proof" },
  { id: "audience", label: "Audience" },
];

// ─── Small shared editor bits ─────────────────────────────────────────────────

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

/** A labelled colour lever — the native picker plus a hex box, kept in sync. */
function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-sans text-sm font-medium text-ink">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} colour picker`}
          value={HEX.test(value) ? value : "#2f5fe0"}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-12 shrink-0 cursor-pointer rounded-control border border-line bg-surface"
        />
        <Input
          aria-label={`${label} hex value`}
          value={value}
          maxLength={7}
          onChange={(e) => {
            const v = e.target.value;
            if (HEX.test(v)) onChange(v);
            else onChange(v); // let the schema/preview reflect an in-progress value
          }}
          className="font-mono"
        />
      </div>
    </div>
  );
}

/** Editable chips — the vocabulary and decision-maker-role editors (add + remove). */
function ChipsEditor({
  values,
  onChange,
  placeholder,
  maxLength,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  maxLength: number;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const v = draft.trim().slice(0, maxLength);
    if (!v || values.includes(v)) {
      setDraft("");
      return;
    }
    onChange([...values, v]);
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-2.5">
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {values.map((v, i) => (
            <span
              key={v}
              className="inline-flex w-fit items-center gap-2 rounded-pill bg-surface-subtle px-4 py-1.5 font-sans text-sm text-ink-strong"
            >
              {v}
              <button
                type="button"
                aria-label={`Remove ${v}`}
                onClick={() => onChange(values.filter((_, j) => j !== i))}
                className="font-mono text-xs text-ink-faint transition-colors hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className="min-w-0 flex-1"
        />
        <Button type="button" variant="secondary" size="sm" onClick={add}>
          Add
        </Button>
      </div>
    </div>
  );
}

/** The white section shell every studio section shares. */
function SectionShell({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    // `scroll-mt` clears the sticky nav + save bar when an anchor link jumps here.
    <section id={id} className="scroll-mt-40">
      <Card variant="elevated" padding="lg">
        <div className="flex flex-col gap-6">
          <SectionHeader title={title} description={description} size="h3" as="h2" />
          {children}
        </div>
      </Card>
    </section>
  );
}

// ─── The studio ───────────────────────────────────────────────────────────────

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error"; message: string };

export function CustomizeStudio({ initialConfig }: { initialConfig: Config }) {
  const router = useRouter();
  const [config, setConfig] = useState<Config>(initialConfig);
  const [save, setSave] = useState<SaveState>({ status: "idle" });

  const patchBrand = (patch: Partial<Brand>) =>
    setConfig((c) => ({ ...c, brand: { ...c.brand, ...patch } }));
  const patchBusiness = (patch: Partial<Business>) =>
    setConfig((c) => ({ ...c, business: { ...c.business, ...patch } }));
  const setSignals = (signals: Signal[]) => setConfig((c) => ({ ...c, signals }));
  const patchPitch = (patch: Partial<Config["pitch"]>) =>
    setConfig((c) => ({ ...c, pitch: { ...c.pitch, ...patch } }));
  const patchOpener = (patch: Partial<Config["pitch"]["opener"]>) =>
    setConfig((c) => ({ ...c, pitch: { ...c.pitch, opener: { ...c.pitch.opener, ...patch } } }));
  const setProof = (proof: ProofPoint[]) => setConfig((c) => ({ ...c, proof }));

  // Reuse the exact server schema to gate Save, so the client never posts something
  // the route would 422. `dirty` marks whether anything changed since load.
  const validity = useMemo(() => WorkspaceConfigSchema.safeParse(config), [config]);
  const dirty = useMemo(
    () => JSON.stringify(config) !== JSON.stringify(initialConfig),
    [config, initialConfig],
  );

  async function handleSave() {
    if (!validity.success) return;

    // Renaming a signal must follow through to the feed: each sample-feed prospect
    // holds a denormalized COPY of the names it fires, so build an old->new map
    // from the loaded vs edited signals and rewrite any matching feed label. Local
    // state is updated to the same value we post, so `dirty` settles after refresh.
    const renames = buildSignalRenameMap(initialConfig.signals, config.signals);
    const configToSave: Config =
      renames.size === 0
        ? config
        : { ...config, sampleFeed: applySignalRenamesToSampleFeed(config.sampleFeed, renames) };
    if (configToSave !== config) setConfig(configToSave);

    setSave({ status: "saving" });
    try {
      const res = await fetch("/api/workspace/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: configToSave }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        setSave({ status: "saved" });
        // Re-run the server layout so the whole app re-skins to the saved brand.
        router.refresh();
      } else {
        setSave({
          status: "error",
          message: data.error ?? "We could not save your changes.",
        });
      }
    } catch {
      setSave({ status: "error", message: "We could not reach the server. Try again." });
    }
  }

  const canSave = validity.success && dirty && save.status !== "saving";

  return (
    <div className="gradient-hero-calm flex flex-1 flex-col">
      <TopNav tone="dark" />

      {/* Sticky save bar — the one primary action, always in reach. Sits just under
          the 69px nav. */}
      <div className="sticky top-[69px] z-40 border-b border-white/20 bg-white/5 backdrop-blur-[25px]">
        <PageContainer className="flex flex-wrap items-center justify-between gap-4 py-3">
          <div className="flex flex-col">
            <span className="font-display text-h5 font-book tracking-brand text-white">
              Customize your engine
            </span>
            <span className="font-sans text-sm text-white/70">
              {save.status === "saved" && !dirty
                ? "Saved. Your engine is updated."
                : dirty
                  ? "You have unsaved changes."
                  : "Every lever the Adapter set, yours to change."}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {save.status === "error" ? (
              <span role="status" className="max-w-xs font-sans text-sm text-white">
                {save.message}
              </span>
            ) : null}
            <Button
              variant="primary-dark"
              size="md"
              onClick={handleSave}
              disabled={!canSave}
            >
              {save.status === "saving" ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </PageContainer>
      </div>

      <main className="flex flex-1 flex-col">
        <PageContainer className="flex flex-col gap-6 pb-16 pt-6">
          {/* Section jump nav — anchored links, so a long editor stays navigable. */}
          <nav
            aria-label="Studio sections"
            className="flex flex-wrap gap-2 rounded-card bg-white/10 p-2 backdrop-blur-sm"
          >
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="rounded-control px-3 py-1.5 font-sans text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                {s.label}
              </a>
            ))}
          </nav>

          {!validity.success ? (
            <Card variant="flat" padding="md">
              <p className="font-sans text-sm text-ink-body">
                A few fields still need a value before you can save. Every signal needs a
                name, a reason, a source, and a freshness window; every proof point with a
                link needs a valid web address. Fill those in and Save turns on.
              </p>
            </Card>
          ) : null}

          <BrandSection brand={config.brand} onChange={patchBrand} />
          <SignalsSection signals={config.signals} onChange={setSignals} />
          <PitchSection
            pitch={config.pitch}
            onPatchPitch={patchPitch}
            onPatchOpener={patchOpener}
          />
          <ProofSection proof={config.proof} onChange={setProof} />
          <AudienceSection business={config.business} onChange={patchBusiness} />
        </PageContainer>
      </main>
    </div>
  );
}

// ─── Brand ────────────────────────────────────────────────────────────────────

function BrandSection({
  brand,
  onChange,
}: {
  brand: Brand;
  onChange: (patch: Partial<Brand>) => void;
}) {
  return (
    <SectionShell
      id="brand"
      title="Brand"
      description="Your name and your look. The preview updates as you type; Save paints it across the whole app."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Field label="Product name">
            <Input
              maxLength={40}
              value={brand.productName}
              onChange={(e) => onChange({ productName: e.target.value })}
            />
          </Field>
          <Field label="Company name">
            <Input
              maxLength={80}
              value={brand.companyName}
              onChange={(e) => onChange({ companyName: e.target.value })}
            />
          </Field>
          <Field label="Wordmark" hint="The text shown in the top-left of the nav.">
            <Input
              maxLength={40}
              value={brand.logoText}
              onChange={(e) => onChange({ logoText: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <ColorField
              label="Primary color"
              value={brand.primaryColor}
              onChange={(hex) => onChange({ primaryColor: hex })}
            />
            <ColorField
              label="Accent color"
              value={brand.accentColor}
              onChange={(hex) => onChange({ accentColor: hex })}
            />
            <ColorField
              label="Hero gradient from"
              value={brand.heroFrom}
              onChange={(hex) => onChange({ heroFrom: hex })}
            />
            <ColorField
              label="Hero gradient to"
              value={brand.heroTo}
              onChange={(hex) => onChange({ heroTo: hex })}
            />
          </div>
        </div>

        <BrandPreview brand={brand} />
      </div>
    </SectionShell>
  );
}

/** The live preview — a mini nav + sample card, re-skinned in real time (P3 pattern). */
function BrandPreview({ brand }: { brand: Brand }) {
  // Only feed the theme engine a valid brand; an in-progress hex would throw the
  // HSL math. Falls back to the last-good full brand shape.
  const safeVars = useMemo(() => {
    const ok =
      HEX.test(brand.primaryColor) &&
      HEX.test(brand.accentColor) &&
      HEX.test(brand.heroFrom) &&
      HEX.test(brand.heroTo);
    return ok ? brandVars(brand) : {};
  }, [brand]);

  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-xs uppercase tracking-eyebrow text-ink-faint">
        Live preview
      </span>
      <div
        style={safeVars}
        className="overflow-hidden rounded-card border border-line shadow-card"
      >
        <div className="gradient-hero flex items-center gap-2.5 px-5 py-3.5">
          <span className="font-display text-base font-book tracking-brand text-white">
            {brand.companyName || "Your company"}
          </span>
          <span className="rounded-pill bg-white/15 px-2.5 py-1 font-mono text-xs font-medium uppercase leading-none text-white">
            {brand.productName || "Product"}
          </span>
        </div>
        <div className="flex flex-col gap-3 bg-surface-card p-5">
          <span className="w-fit rounded-pill gradient-signal-staffing-spike px-4 py-1.5 font-sans text-xs leading-none text-white">
            Buying moment
          </span>
          <p className="font-display text-h5 font-book tracking-brand text-ink">
            A prospect just hit a buying moment.
          </p>
          <div>
            <Button variant="primary" size="sm">
              View brief
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Signals ──────────────────────────────────────────────────────────────────

function SignalsSection({
  signals,
  onChange,
}: {
  signals: Signal[];
  onChange: (next: Signal[]) => void;
}) {
  function update(i: number, patch: Partial<Signal>) {
    onChange(signals.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  }
  function remove(i: number) {
    onChange(signals.filter((_, j) => j !== i));
  }
  function add() {
    onChange([
      ...signals,
      { name: "", kind: "custom", why: "", dataSource: "Public sources", freshnessDays: 30 },
    ]);
  }

  return (
    <SectionShell
      id="signals"
      title="Buying-moment signals"
      description="The heart of it: the moments that say a company is about to buy. Keep them, reword them, add your own."
    >
      <div className="flex flex-col gap-4">
        {signals.map((signal, i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-panel border border-line-soft bg-surface-card p-5"
          >
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
                onChange={(e) => update(i, { name: e.target.value })}
                placeholder="Name this buying moment"
                className="font-medium"
              />
              {signals.length > 1 ? (
                <Button variant="tertiary" size="sm" onClick={() => remove(i)}>
                  Remove
                </Button>
              ) : null}
            </div>
            <Field label="Why it predicts a buy">
              <Textarea
                rows={2}
                maxLength={500}
                value={signal.why}
                onChange={(e) => update(i, { why: e.target.value })}
                placeholder="What about this moment means they're ready?"
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <Field label="Signal type" hint="A short label, e.g. hiring or funding.">
                <Input
                  maxLength={60}
                  value={signal.kind}
                  onChange={(e) => update(i, { kind: e.target.value })}
                />
              </Field>
              <Field label="Where to watch">
                <Input
                  maxLength={200}
                  value={signal.dataSource}
                  onChange={(e) => update(i, { dataSource: e.target.value })}
                />
              </Field>
              <Field label="Stays hot (days)">
                <Input
                  type="number"
                  min={1}
                  max={730}
                  value={String(signal.freshnessDays)}
                  onChange={(e) => {
                    const n = Math.trunc(Number(e.target.value));
                    update(i, {
                      freshnessDays: Number.isFinite(n)
                        ? Math.min(730, Math.max(1, n))
                        : signal.freshnessDays,
                    });
                  }}
                  className="w-28"
                />
              </Field>
            </div>
          </div>
        ))}
        {signals.length < 20 ? (
          <Button variant="secondary" size="sm" onClick={add} className="w-fit">
            Add a signal
          </Button>
        ) : null}
      </div>
    </SectionShell>
  );
}

// ─── Pitch ────────────────────────────────────────────────────────────────────

function PitchSection({
  pitch,
  onPatchPitch,
  onPatchOpener,
}: {
  pitch: Config["pitch"];
  onPatchPitch: (patch: Partial<Config["pitch"]>) => void;
  onPatchOpener: (patch: Partial<Config["pitch"]["opener"]>) => void;
}) {
  const { opener, discoveryQuestions, objections } = pitch;

  function setQuestion(i: number, value: string) {
    onPatchPitch({
      discoveryQuestions: discoveryQuestions.map((q, j) => (j === i ? value : q)),
    });
  }
  function addQuestion() {
    if (discoveryQuestions.length >= 10) return;
    onPatchPitch({ discoveryQuestions: [...discoveryQuestions, ""] });
  }
  function removeQuestion(i: number) {
    if (discoveryQuestions.length <= 1) return;
    onPatchPitch({ discoveryQuestions: discoveryQuestions.filter((_, j) => j !== i) });
  }

  function setObjection(i: number, patch: Partial<Objection>) {
    onPatchPitch({
      objections: objections.map((o, j) => (j === i ? { ...o, ...patch } : o)),
    });
  }
  function addObjection() {
    if (objections.length >= 10) return;
    onPatchPitch({ objections: [...objections, { q: "", rebuttal: "" }] });
  }
  function removeObjection(i: number) {
    if (objections.length <= 1) return;
    onPatchPitch({ objections: objections.filter((_, j) => j !== i) });
  }

  return (
    <SectionShell
      id="pitch"
      title="Pitch"
      description="How your team opens, what they ask, and how they answer the pushback."
    >
      <div className="flex flex-col gap-6">
        <Field label="Why it fits (pain fit)">
          <Textarea
            rows={3}
            maxLength={1000}
            value={pitch.painFit}
            onChange={(e) => onPatchPitch({ painFit: e.target.value })}
          />
        </Field>

        <div className="flex flex-col gap-4 rounded-panel bg-surface-subtle p-5">
          <span className="font-sans text-sm font-medium text-ink-strong">The opener</span>
          <Field label="Lead with">
            <Textarea
              rows={2}
              maxLength={500}
              value={opener.leadWith}
              onChange={(e) => onPatchOpener({ leadWith: e.target.value })}
            />
          </Field>
          <Field label="Tone">
            <Input
              maxLength={200}
              value={opener.tone}
              onChange={(e) => onPatchOpener({ tone: e.target.value })}
            />
          </Field>
          <Field label="Vocabulary" hint="The words that sound like your buyer's world.">
            <ChipsEditor
              values={opener.vocabulary}
              onChange={(vocabulary) => onPatchOpener({ vocabulary })}
              placeholder="Add a word and press Enter"
              maxLength={60}
            />
          </Field>
          <Field label="Example opener">
            <Textarea
              rows={3}
              maxLength={1000}
              value={opener.exampleOpener}
              onChange={(e) => onPatchOpener({ exampleOpener: e.target.value })}
            />
          </Field>
        </div>

        <div className="flex flex-col gap-3">
          <span className="font-sans text-sm font-medium text-ink-strong">
            Discovery questions
          </span>
          {discoveryQuestions.map((q, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="font-mono text-sm text-ink-faint">{i + 1}</span>
              <Input
                maxLength={300}
                value={q}
                onChange={(e) => setQuestion(i, e.target.value)}
                className="min-w-0 flex-1"
              />
              {discoveryQuestions.length > 1 ? (
                <Button variant="tertiary" size="sm" onClick={() => removeQuestion(i)}>
                  Remove
                </Button>
              ) : null}
            </div>
          ))}
          {discoveryQuestions.length < 10 ? (
            <Button variant="secondary" size="sm" onClick={addQuestion} className="w-fit">
              Add a question
            </Button>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <span className="font-sans text-sm font-medium text-ink-strong">
            Objections & rebuttals
          </span>
          {objections.map((o, i) => (
            <div
              key={i}
              className="flex flex-col gap-3 rounded-panel border border-line-soft bg-surface-card p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="font-sans text-sm text-ink-muted">Objection {i + 1}</span>
                {objections.length > 1 ? (
                  <Button variant="tertiary" size="sm" onClick={() => removeObjection(i)}>
                    Remove
                  </Button>
                ) : null}
              </div>
              <Field label="What they say">
                <Input
                  maxLength={300}
                  value={o.q}
                  onChange={(e) => setObjection(i, { q: e.target.value })}
                />
              </Field>
              <Field label="How you answer">
                <Textarea
                  rows={2}
                  maxLength={1000}
                  value={o.rebuttal}
                  onChange={(e) => setObjection(i, { rebuttal: e.target.value })}
                />
              </Field>
            </div>
          ))}
          {objections.length < 10 ? (
            <Button variant="secondary" size="sm" onClick={addObjection} className="w-fit">
              Add an objection
            </Button>
          ) : null}
        </div>
      </div>
    </SectionShell>
  );
}

// ─── Proof ────────────────────────────────────────────────────────────────────

function isProven(p: ProofPoint): p is Extract<ProofPoint, { sourceUrl: string }> {
  return !("tag" in p);
}

function ProofSection({
  proof,
  onChange,
}: {
  proof: ProofPoint[];
  onChange: (next: ProofPoint[]) => void;
}) {
  function update(i: number, next: ProofPoint) {
    onChange(proof.map((p, j) => (j === i ? next : p)));
  }
  function remove(i: number) {
    onChange(proof.filter((_, j) => j !== i));
  }
  function add() {
    if (proof.length >= 20) return;
    onChange([...proof, { claim: "", tag: "pending" }]);
  }

  return (
    <SectionShell
      id="proof"
      title="Proof"
      description="The results a buyer would care about. Add a link when you have one, or mark it pending until you do."
    >
      <div className="flex flex-col gap-4">
        {proof.length === 0 ? (
          <p className="font-sans text-sm text-ink-muted">
            No proof points yet. That&apos;s honest, not broken. Add one when you have a
            result worth sharing.
          </p>
        ) : null}

        {proof.map((p, i) => {
          const proven = isProven(p);
          return (
            <div
              key={i}
              className="flex flex-col gap-3 rounded-panel border border-line-soft bg-surface-card p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <Badge tone={proven ? "neutral" : "warn"} size="sm">
                  {proven ? "Has a link" : "Pending"}
                </Badge>
                <Button variant="tertiary" size="sm" onClick={() => remove(i)}>
                  Remove
                </Button>
              </div>

              <Field label="The result (claim)">
                <Input
                  maxLength={300}
                  value={p.claim}
                  onChange={(e) => update(i, { ...p, claim: e.target.value })}
                />
              </Field>

              {proven ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="The number (metric)">
                    <Input
                      maxLength={200}
                      value={p.metric}
                      onChange={(e) => update(i, { ...p, metric: e.target.value })}
                    />
                  </Field>
                  <Field label="Source link" hint="A full web address, e.g. https://…">
                    <Input
                      type="url"
                      value={p.sourceUrl}
                      onChange={(e) => update(i, { ...p, sourceUrl: e.target.value })}
                    />
                  </Field>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3">
                {proven ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => update(i, { claim: p.claim, tag: "pending" })}
                  >
                    Mark pending
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => update(i, { claim: p.claim, metric: "", sourceUrl: "" })}
                  >
                    Add a link
                  </Button>
                )}
              </div>
            </div>
          );
        })}

        {proof.length < 20 ? (
          <Button variant="secondary" size="sm" onClick={add} className="w-fit">
            Add a proof point
          </Button>
        ) : null}
      </div>
    </SectionShell>
  );
}

// ─── Audience ─────────────────────────────────────────────────────────────────

function AudienceSection({
  business,
  onChange,
}: {
  business: Business;
  onChange: (patch: Partial<Business>) => void;
}) {
  return (
    <SectionShell
      id="audience"
      title="Audience"
      description="Who you sell to and where they are. This aims the whole engine."
    >
      <div className="flex flex-col gap-4">
        <Field label="Your one-liner" hint="One plain sentence on what you do.">
          <Input
            maxLength={200}
            value={business.oneLiner}
            onChange={(e) => onChange({ oneLiner: e.target.value })}
          />
        </Field>
        <Field label="What you sell">
          <Textarea
            rows={3}
            maxLength={2000}
            value={business.whatYouSell}
            onChange={(e) => onChange({ whatYouSell: e.target.value })}
          />
        </Field>
        <Field label="Your ideal customer">
          <Textarea
            rows={3}
            maxLength={500}
            value={business.icp}
            onChange={(e) => onChange({ icp: e.target.value })}
          />
        </Field>
        <Field label="Who signs off" hint="The roles that make the call.">
          <ChipsEditor
            values={business.decisionMakerRoles}
            onChange={(decisionMakerRoles) => onChange({ decisionMakerRoles })}
            placeholder="Add a role and press Enter"
            maxLength={80}
          />
        </Field>
        <Field label="Where your customers are">
          <Input
            maxLength={200}
            value={business.geography}
            onChange={(e) => onChange({ geography: e.target.value })}
          />
        </Field>
      </div>
    </SectionShell>
  );
}
