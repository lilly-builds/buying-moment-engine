"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { brandVars } from "@/design/brand";
import { LogoMark } from "@/design/components";
import { cn } from "@/design/lib/cn";
import type { DraftWorkspaceConfig } from "@/src/adapt/schema";
import { SampleSignalPill } from "../../sample-signal-pill";
import type { RevealFlags } from "@/src/adapt/chat/machine";

/**
 * The right-side live preview for `/adapt/chat` — the real app assembling itself
 * as the conversation moves. It reuses the app's own visual language (the hero
 * gradient nav, the signal pills, the feed rows) and themes live through
 * `brandVars(draft.brand)`.
 *
 * The brand reveal is the payoff, so the whole surface assembles in grayscale and
 * floods to the tenant's color in one beat when `reveal.brand` lands: the CSS
 * variables switch to the tenant AND the `grayscale` filter animates off together,
 * so a gray wireframe becomes their branded engine over ~700ms. Each earlier slot
 * (audience, signals) crossfades from a skeleton to its content as its turn arrives.
 *
 * Decorative on purpose: the panel is `aria-hidden`. The accessible narrative is the
 * conversation stream on the left (`aria-live`), which says everything this shows.
 */

type Draft = DraftWorkspaceConfig;

export interface PreviewPanelProps {
  draft: Draft | null;
  reveal: RevealFlags;
  /** Known from the opening turn, before the draft exists. */
  companyName: string;
}

/** Clearly-synthetic teaser names for the assembled feed. Never a real company. */
const PREVIEW_NAMES = ["Northwind Trading Co.", "Cedar & Vale", "Brightline Labs"];

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-pill bg-ink/[0.07] animate-pulse motion-reduce:animate-none",
        className,
      )}
    />
  );
}

/** A slot's content mount: a short rise + fade the first time it appears. */
function Rise({ children, delayMs = 0 }: { children: ReactNode; delayMs?: number }) {
  return (
    <div
      className="animate-card-glide-in motion-reduce:animate-none"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      {children}
    </div>
  );
}

function SlotLabel({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-[11px] uppercase tracking-eyebrow text-ink-faint">{children}</p>
  );
}

export function PreviewPanel({ draft, reveal, companyName }: PreviewPanelProps) {
  const colored = reveal.brand && draft !== null;
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Keep the newest revealed slot in view as the app fills in.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [reveal.audience, reveal.signals, reveal.proof, reveal.feed]);

  const themedStyle = {
    ...(colored && draft ? brandVars(draft.brand) : {}),
    filter: colored ? "grayscale(0)" : "grayscale(1)",
  } as CSSProperties;

  const wordmark = companyName.trim() || draft?.brand.companyName || "Your engine";
  const roles = draft?.business.decisionMakerRoles.slice(0, 3) ?? [];
  const signals = draft?.signals ?? [];
  const proof = reveal.proof ? draft?.proof[0] : undefined;
  const proofLine = proof && "claim" in proof ? proof.claim : undefined;

  return (
    <div
      aria-hidden
      className="flex h-full w-full max-w-xl flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card"
    >
      {/* Window chrome — stays neutral; the themed layer below carries the brand. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line-soft bg-surface-canvas px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-pill bg-line-cool" />
        <span className="h-2.5 w-2.5 rounded-pill bg-line-cool" />
        <span className="h-2.5 w-2.5 rounded-pill bg-line-cool" />
        <span className="ml-2 font-mono text-[11px] tracking-eyebrow text-ink-faint">
          your engine
        </span>
      </div>

      <div
        style={themedStyle}
        className="flex min-h-0 flex-1 flex-col transition-[filter] duration-700 ease-out motion-reduce:transition-none"
      >
        {/* Hero / nav — the brand identity floods in with the color. */}
        <div className="gradient-hero shrink-0 px-5 pb-5 pt-4">
          <div className="flex items-center gap-2.5">
            <LogoMark size={22} />
            <span className="font-display text-sm font-book tracking-brand text-white">
              {wordmark}
            </span>
            {colored && draft ? (
              <span className="rounded-pill bg-white/15 px-2.5 py-1 font-mono text-[10px] font-medium uppercase leading-none text-white">
                {draft.brand.productName}
              </span>
            ) : (
              <Skeleton className="h-4 w-16 bg-white/25" />
            )}
          </div>
          <p className="mt-3 font-display text-base font-book tracking-brand text-white">
            Prospects at a buying moment
          </p>
        </div>

        {/* Body — the slots fill from skeleton to content as each turn lands. */}
        <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto bg-surface p-5">
          {/* Audience */}
          <div className="flex flex-col gap-2">
            <SlotLabel>Who buys this</SlotLabel>
            {reveal.audience && draft ? (
              <Rise>
                <div className="flex flex-col gap-2.5 rounded-panel bg-surface-card p-4">
                  <p className="font-sans text-sm text-ink-body">{draft.business.icp}</p>
                  {roles.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {roles.map((role) => (
                        <span
                          key={role}
                          className="w-fit rounded-pill bg-ink/[0.06] px-2.5 py-1 font-sans text-xs text-ink-body"
                        >
                          {role}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {proofLine ? (
                    <Rise>
                      <p className="border-t border-line-soft pt-2.5 font-sans text-xs text-ink-muted">
                        <span className="font-medium text-ink">Proof.</span> {proofLine}
                      </p>
                    </Rise>
                  ) : null}
                </div>
              </Rise>
            ) : (
              <div className="flex flex-col gap-2 rounded-panel bg-surface-card p-4">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
                <div className="mt-1 flex gap-1.5">
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-5 w-20" />
                </div>
              </div>
            )}
          </div>

          {/* Signals — the heart. */}
          <div className="flex flex-col gap-2">
            <SlotLabel>Buying moments</SlotLabel>
            {reveal.signals && signals.length > 0 ? (
              <div className="flex flex-col gap-2.5">
                {signals.slice(0, 4).map((signal, i) => (
                  <Rise key={signal.name + i} delayMs={i * 90}>
                    <div className="flex flex-col gap-2 rounded-panel bg-surface-card p-3.5">
                      <SampleSignalPill name={signal.name} />
                      <p className="line-clamp-2 font-sans text-xs leading-relaxed text-ink-muted">
                        {signal.why}
                      </p>
                    </div>
                  </Rise>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex flex-col gap-2 rounded-panel bg-surface-card p-3.5">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Feed — the first prospects, assembled at the finalize step. */}
          <div className="flex flex-col gap-2">
            <SlotLabel>
              Your first prospects
              {reveal.feed === "skeleton" ? (
                <span className="ml-2 normal-case tracking-normal text-ink-faint">assembling</span>
              ) : null}
            </SlotLabel>
            {reveal.feed === "filled" && draft ? (
              <div className="flex flex-col gap-2.5">
                {PREVIEW_NAMES.map((name, i) => {
                  const signal = signals[i % Math.max(signals.length, 1)];
                  return (
                    <Rise key={name} delayMs={i * 110}>
                      <div className="flex items-center justify-between gap-3 rounded-panel bg-surface-card p-3.5 shadow-soft ring-1 ring-ink/[0.05]">
                        <div className="flex min-w-0 flex-col gap-1.5">
                          <p className="truncate font-display text-sm font-book text-ink">{name}</p>
                          {signal ? <SampleSignalPill name={signal.name} /> : null}
                        </div>
                        <span className="shrink-0 rounded-control bg-brand px-2.5 py-1.5 font-sans text-[11px] leading-none text-white">
                          View brief
                        </span>
                      </div>
                    </Rise>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-3 rounded-panel bg-surface-card p-3.5"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <Skeleton className="h-3.5 w-2/5" />
                      <Skeleton className="h-5 w-28" />
                    </div>
                    <Skeleton className="h-6 w-16" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
