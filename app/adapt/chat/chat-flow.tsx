"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button, Input, Textarea } from "@/design/components";
import { cn } from "@/design/lib/cn";
import { buildFallbackDraft } from "@/src/adapt/fallback";
import {
  chatReducer,
  initialState,
  type ChatState,
  type Turn,
} from "@/src/adapt/chat/machine";
import { brandSwatches } from "@/src/adapt/chat/voice";
import type { DraftWorkspaceConfig } from "@/src/adapt/schema";
import { PreviewPanel } from "./preview-panel";

/**
 * The conversational variant of Adapt-It onboarding (`/adapt/chat`).
 *
 * A split layout: the conversation on the left, the real app building itself on the
 * right. The client owns a state machine (`src/adapt/chat/machine.ts`) and drives the
 * SAME two backend calls the form flow uses. The Adapter's connective lines are
 * crafted (`src/adapt/chat/voice.ts`) and interpolate the AI values, so every turn is
 * instant and on-voice; the only waits are the two ~30s round-trips, each of which
 * shows a live building state on the right and a concrete line on the left.
 */

export function ChatFlow() {
  const [state, dispatch] = useReducer(chatReducer, undefined, initialState);

  // Fire the two backend calls once each. Refs guard against React's double-invoked
  // effects (StrictMode) and re-renders.
  const genFired = useRef(false);
  const finalizeFired = useRef(-1);

  // Generate: kicked off the moment we enter the generating phase. It never
  // dead-ends — any failure falls back to the deterministic client draft.
  useEffect(() => {
    if (state.phase !== "generating" || genFired.current) return;
    genFired.current = true;
    const intro = state.intro;
    if (!intro) return;
    (async () => {
      try {
        const res = await fetch("/api/adapt/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            companyName: intro.companyName,
            whatYouSell: intro.whatYouSell,
            websiteUrl: intro.websiteUrl,
          }),
        });
        const data = (await res.json()) as { config?: DraftWorkspaceConfig };
        if (res.ok && data.config) {
          dispatch({ type: "GENERATED", draft: data.config });
          return;
        }
      } catch {
        // fall through to the deterministic draft below
      }
      dispatch({ type: "GENERATED", draft: buildFallbackDraft(intro) });
    })();
  }, [state.phase, state.intro]);

  // Finalize: persists the workspace, sets the active cookie, returns a slug. This
  // one CAN fail honestly (DB unreachable), so it surfaces a retry rather than faking
  // a done. Keyed on the retry nonce so RETRY_FINALIZE re-fires it.
  useEffect(() => {
    if (state.phase !== "finalizing") return;
    if (finalizeFired.current === state.finalizeNonce) return;
    finalizeFired.current = state.finalizeNonce;
    const draft = state.draft;
    if (!draft) return;
    (async () => {
      try {
        const res = await fetch("/api/adapt/finalize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ config: draft }),
        });
        const data = (await res.json()) as { slug?: string };
        if (res.ok && data.slug) {
          dispatch({ type: "FINALIZED" });
          return;
        }
      } catch {
        // fall through to the error branch below
      }
      dispatch({ type: "FINALIZE_ERROR" });
    })();
  }, [state.phase, state.finalizeNonce, state.draft]);

  // The Adapter thinks a short beat, then speaks (and the matching preview slot
  // reveals). This is what keeps the left line and the right reveal in lockstep.
  useEffect(() => {
    if (!state.pendingAdapter) return;
    const t = window.setTimeout(() => dispatch({ type: "ADAPTER_SPEAK" }), 460);
    return () => window.clearTimeout(t);
  }, [state.pendingAdapter]);

  // On success, hold a real beat so the finished feed is felt (the payoff), then
  // hard-navigate so the dashboard picks up the freshly-set active-workspace cookie.
  // The CTA lets an impatient user go now; this is the gentle fallback.
  useEffect(() => {
    if (state.phase !== "done") return;
    const t = window.setTimeout(() => {
      window.location.href = "/";
    }, 9000);
    return () => window.clearTimeout(t);
  }, [state.phase]);

  const companyName = state.intro?.companyName ?? state.draft?.brand.companyName ?? "";

  return (
    <main className="flex h-[100dvh] flex-col overflow-hidden bg-surface lg:flex-row">
      {/* LEFT — the conversation */}
      <section className="flex min-h-0 flex-1 flex-col lg:h-full lg:w-[46%] lg:flex-none">
        <div className="flex items-center justify-between px-6 pt-6 sm:px-10">
          <span className="font-mono text-xs uppercase tracking-eyebrow text-ink-faint">
            The Adapter
          </span>
          <Link
            href="/adapt"
            className="rounded-control font-sans text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline"
          >
            Prefer a quick form?
          </Link>
        </div>

        <Conversation turns={state.turns} thinking={state.pendingAdapter} />

        <div className="shrink-0 border-t border-line-soft px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 sm:px-10">
          <Dock state={state} dispatch={dispatch} />
        </div>
      </section>

      {/* RIGHT — the app assembling itself. On small screens it becomes a peek at
          the top so the conversation and its composer keep the reachable bottom. */}
      <section className="order-first flex h-[34dvh] shrink-0 items-center justify-center overflow-hidden bg-surface-canvas px-6 py-4 lg:order-none lg:h-full lg:w-[54%] lg:flex-none lg:px-10 lg:py-8">
        <PreviewPanel draft={state.draft} reveal={state.reveal} companyName={companyName} />
      </section>
    </main>
  );
}

// ─── The conversation stream ──────────────────────────────────────────────────

/** A small calm presence mark for the Adapter — the onboarding orb, shrunk. */
function AdapterMark() {
  return (
    <span aria-hidden className="relative flex h-7 w-7 shrink-0 items-center justify-center">
      <span className="absolute h-7 w-7 rounded-pill gradient-orb opacity-50 blur-md" />
      <span className="relative h-4 w-4 rounded-pill gradient-orb shadow-ring" />
    </span>
  );
}

function ThinkingDots() {
  return (
    <span className="flex items-center gap-1 py-1" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-pill bg-ink-faint animate-pulse motion-reduce:animate-none"
          style={{ animationDelay: `${i * 200}ms`, animationDuration: "1.1s" }}
        />
      ))}
    </span>
  );
}

function Conversation({ turns, thinking }: { turns: Turn[]; thinking: boolean }) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    endRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "end" });
  }, [turns.length, thinking]);

  return (
    <div
      role="log"
      aria-live="polite"
      aria-label="Conversation with the Adapter"
      className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-8 sm:px-10"
    >
      {turns.map((turn, i) => {
        if (turn.role === "user") {
          return (
            <div key={turn.id} className="chat-msg-in flex justify-end">
              <div className="max-w-[85%] whitespace-pre-line rounded-2xl rounded-br-md bg-ink/[0.04] px-4 py-2.5 text-right font-sans text-base text-ink-body">
                {turn.text}
              </div>
            </div>
          );
        }
        // Show the presence mark only at the start of an Adapter group so a run of
        // lines reads as one considered voice, not a stack of orbs.
        const startsGroup = i === 0 || turns[i - 1].role !== "adapter";
        return (
          <div key={turn.id} className="animate-card-glide-in flex gap-3">
            <div className="w-7 shrink-0">{startsGroup ? <AdapterMark /> : null}</div>
            <p className="max-w-[92%] text-balance font-sans text-lg leading-relaxed text-ink">
              {turn.text}
            </p>
          </div>
        );
      })}

      {thinking ? (
        <div className="flex gap-3">
          <div className="w-7 shrink-0">
            <AdapterMark />
          </div>
          <ThinkingDots />
        </div>
      ) : null}

      <div ref={endRef} />
    </div>
  );
}

// ─── The dock (input area), by phase ──────────────────────────────────────────

function Dock({
  state,
  dispatch,
}: {
  state: ChatState;
  dispatch: React.Dispatch<Parameters<typeof chatReducer>[1]>;
}) {
  switch (state.phase) {
    case "opening":
      return <IntroComposer dispatch={dispatch} />;
    case "audience":
      return <AudienceDock state={state} dispatch={dispatch} />;
    case "signals":
      return <SignalsDock state={state} dispatch={dispatch} />;
    case "proof":
      return <ProofDock dispatch={dispatch} />;
    case "brand":
      return <BrandDock state={state} dispatch={dispatch} />;
    case "finalizing":
      return state.finalizeError ? (
        <div className="flex flex-col gap-3">
          <p className="font-sans text-sm text-ink-body">
            We could not save your workspace just yet. One more try should do it.
          </p>
          <div>
            <Button variant="primary" onClick={() => dispatch({ type: "RETRY_FINALIZE" })}>
              Try again
            </Button>
          </div>
        </div>
      ) : (
        <p className="font-sans text-sm text-ink-faint">Building your engine on the right.</p>
      );
    case "done":
      return (
        <div>
          <Button variant="primary" size="lg" onClick={() => (window.location.href = "/")}>
            Open your dashboard
          </Button>
        </div>
      );
    case "generating":
    default:
      return <p className="font-sans text-sm text-ink-faint">Reading your business on the right.</p>;
  }
}

type Dispatch = React.Dispatch<Parameters<typeof chatReducer>[1]>;

/** A quiet, pill-shaped quick reply. */
function Chip({
  children,
  onClick,
  tone = "default",
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: "default" | "primary";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-pill border px-4 py-2 font-sans text-sm transition-colors",
        tone === "primary"
          ? "border-brand bg-brand text-white hover:bg-brand-800"
          : "border-line text-ink-body hover:border-line-cool hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function IntroComposer({ dispatch }: { dispatch: Dispatch }) {
  const [companyName, setCompanyName] = useState("");
  const [whatYouSell, setWhatYouSell] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const ready = companyName.trim().length > 0 && whatYouSell.trim().length > 0;

  function submit() {
    if (!ready) return;
    dispatch({
      type: "SUBMIT_INTRO",
      companyName,
      whatYouSell,
      websiteUrl: websiteUrl.trim() || null,
    });
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-col gap-2.5">
        <Input
          autoFocus
          aria-label="Company name"
          maxLength={80}
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          placeholder="Company name"
        />
        <Textarea
          rows={2}
          aria-label="What you sell"
          maxLength={2000}
          value={whatYouSell}
          onChange={(e) => setWhatYouSell(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          placeholder="What you sell, in a line"
        />
        <Input
          type="url"
          aria-label="Website (optional)"
          value={websiteUrl}
          onChange={(e) => setWebsiteUrl(e.target.value)}
          placeholder="Website (optional)"
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={!ready}>
          Send
        </Button>
      </div>
    </form>
  );
}

function AudienceDock({ state, dispatch }: { state: ChatState; dispatch: Dispatch }) {
  const [editing, setEditing] = useState(false);
  const [icp, setIcp] = useState(state.draft?.business.icp ?? "");

  if (editing) {
    return (
      <div className="flex flex-col gap-3">
        <Textarea
          autoFocus
          rows={3}
          maxLength={500}
          value={icp}
          onChange={(e) => setIcp(e.target.value)}
          aria-label="Who you sell to"
        />
        <div className="flex justify-end gap-2">
          <Chip onClick={() => setEditing(false)}>Cancel</Chip>
          <Chip
            tone="primary"
            onClick={() => {
              if (icp.trim().length > 0) dispatch({ type: "EDIT_AUDIENCE", icp: icp.trim() });
              setEditing(false);
            }}
          >
            Save
          </Chip>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2.5">
      <Chip tone="primary" onClick={() => dispatch({ type: "CONFIRM_AUDIENCE" })}>
        That&apos;s right
      </Chip>
      <Chip onClick={() => setEditing(true)}>Let me fix it</Chip>
    </div>
  );
}

function SignalsDock({ state, dispatch }: { state: ChatState; dispatch: Dispatch }) {
  const signals = state.draft?.signals ?? [];
  const [editing, setEditing] = useState(false);
  const [names, setNames] = useState<string[]>(() => signals.map((s) => s.name));

  if (editing) {
    return (
      <div className="flex flex-col gap-3">
        {names.map((name, i) => (
          <Input
            key={i}
            value={name}
            maxLength={120}
            aria-label={`Buying moment ${i + 1}`}
            onChange={(e) =>
              setNames((prev) => prev.map((n, j) => (j === i ? e.target.value : n)))
            }
          />
        ))}
        <div className="flex justify-end gap-2">
          <Chip onClick={() => setEditing(false)}>Cancel</Chip>
          <Chip
            tone="primary"
            onClick={() => {
              const next = signals.map((s, i) => ({
                ...s,
                name: names[i]?.trim() ? names[i].trim().slice(0, 120) : s.name,
              }));
              dispatch({ type: "EDIT_SIGNALS", signals: next });
              setEditing(false);
            }}
          >
            Save
          </Chip>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2.5">
      <Chip tone="primary" onClick={() => dispatch({ type: "CONFIRM_SIGNALS" })}>
        Keep them
      </Chip>
      <Chip onClick={() => setEditing(true)}>Tweak the names</Chip>
    </div>
  );
}

function ProofDock({ dispatch }: { dispatch: Dispatch }) {
  const [claim, setClaim] = useState("");
  const ready = claim.trim().length > 0;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) dispatch({ type: "SUBMIT_PROOF", claim });
      }}
    >
      <Input
        autoFocus
        value={claim}
        maxLength={300}
        aria-label="Your best result"
        onChange={(e) => setClaim(e.target.value)}
        placeholder="Cut a carrier's fuel spend 12% in 90 days"
      />
      <div className="flex items-center justify-end gap-2.5">
        <Chip onClick={() => dispatch({ type: "SKIP_PROOF" })}>Add proof later</Chip>
        <Button type="submit" variant="primary" disabled={!ready}>
          Send
        </Button>
      </div>
    </form>
  );
}

function BrandDock({ state, dispatch }: { state: ChatState; dispatch: Dispatch }) {
  const draft = state.draft;
  const swatches = useMemo(() => (draft ? brandSwatches(draft) : []), [draft]);
  if (!draft) return null;
  const active = draft.brand.primaryColor;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="font-sans text-sm text-ink-muted">Pick a color</span>
        <div className="flex flex-wrap items-center gap-2.5">
          {swatches.map((swatch) => {
            const selected = swatch.patch.primaryColor === active;
            return (
              <button
                key={swatch.id}
                type="button"
                aria-label={`${swatch.colorName}${swatch.isPick ? ", the pick" : ""}`}
                aria-pressed={selected}
                onClick={() => dispatch({ type: "PICK_COLOR", patch: swatch.patch })}
                className={cn(
                  "h-9 w-9 rounded-pill transition-transform duration-150 motion-reduce:transition-none",
                  selected ? "ring-2 ring-ink ring-offset-2" : "hover:scale-110",
                )}
                style={{
                  backgroundImage: `linear-gradient(135deg, ${swatch.patch.primaryColor}, ${swatch.patch.accentColor})`,
                }}
              />
            );
          })}
        </div>
      </div>
      <div>
        <Button variant="primary" onClick={() => dispatch({ type: "CONFIRM_BRAND" })}>
          Use this
        </Button>
      </div>
    </div>
  );
}
