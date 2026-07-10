"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/design/components";
import { gradients } from "@/design/tokens";
import { StepCard } from "@/design/components/onboarding/step-card";
import {
  buildOnboardingSteps,
  ONBOARDING_STEP_COUNT,
  type StepPage,
} from "@/src/onboarding/steps";

/**
 * OnboardingTour — the "work your first lead" coach-through (U17 · CHUNK #2).
 *
 * Mounted once in the root layout so it survives the feed → brief navigation. It
 * runs over the REAL feed + brief (never a mockup): each step dims the page and
 * spotlights the ONE real element it points at (targeted by a `data-tour="…"`
 * hook), floats the brand StepCard beside it, and the learner CLICKS or hits
 * "Next →" to advance — play it to learn it.
 *
 * Draft-1 shortcut (per the sprint brief): progress persists in localStorage,
 * read through `useSyncExternalStore` so it's SSR-safe without a mount flag. A
 * real per-user `onboarding_state` table + migration is the productionization
 * follow-up, not this sprint.
 *
 * Fully SKIPPABLE and NON-BLOCKING: the dim backdrop is `pointer-events: none`,
 * so the page underneath stays usable, and a persistent "Skip" exits any time.
 */

const STORAGE_KEY = "bme.onboarding.v1";
const CHANGE_EVENT = "bme:onboarding-change";
/** Padding around the spotlit element, and gap between it and the card. */
const SPOTLIGHT_PAD = 12;
const CARD_GAP = 16;
/** The card is a fixed width (`w-[32rem]`, a landscape rectangle); an estimate of its height suffices
 *  (generous, so the taller cards that carry a supporting sentence still clear the target). */
const CARD_W = 512;
const CARD_H_EST = 300;
/** Keep the sticky nav clear when scrolling a target into place. */
const NAV_OFFSET = 88;
/** How long to keep looking for a step's target before falling back to a centred card. */
const TARGET_RETRY_MS = 2500;

type TourStatus = "active" | "done" | "skipped";

interface TourState {
  status: TourStatus;
  /** The `order` of the current step. */
  step: number;
  completed: string[];
}

const FRESH_STATE: TourState = { status: "active", step: 1, completed: [] };
/** On the server (and during hydration) nothing renders — the real state loads after. */
const SERVER_STATE: TourState = { status: "skipped", step: 1, completed: [] };

// The finale confetti — deterministic (no Math.random, so it's hydration-safe): emojis
// spread around a circle, biased upward, and arc outward from the celebration card.
const CELEBRATION_EMOJIS = ["🎉", "🎊", "✨", "🥳", "⭐", "💪", "🔥", "🎈", "🌟", "🙌", "🎯", "💥"];
// A dense burst that explodes OUT of the card in every direction — deterministic
// (no Math.random, so it's hydration-safe). Pieces spread evenly around the circle
// with a little jitter, and fly far enough to shoot well past the card edges.
const CONFETTI = Array.from({ length: 48 }, (_, i) => {
  const angle = (i / 48) * Math.PI * 2 + (i % 3) * 0.11;
  const dist = 340 + (i % 7) * 56;
  return {
    emoji: CELEBRATION_EMOJIS[i % CELEBRATION_EMOJIS.length],
    tx: Math.round(Math.cos(angle) * dist),
    ty: Math.round(Math.sin(angle) * dist) - 30,
    rot: (i % 2 ? 1 : -1) * (160 + (i % 5) * 70),
    delay: (i % 8) * 0.1,
    dur: 1.7 + (i % 5) * 0.3,
    size: 26 + (i % 4) * 8,
  };
});

// -- localStorage-backed external store (stable module-level fns) --------------
let cachedRaw: string | null = null;
let cachedState: TourState = FRESH_STATE;

function parseState(raw: string | null): TourState {
  if (!raw) return FRESH_STATE;
  try {
    const p = JSON.parse(raw) as Partial<TourState>;
    if (p.status !== "active" && p.status !== "done" && p.status !== "skipped") return FRESH_STATE;
    return {
      status: p.status,
      step: typeof p.step === "number" ? p.step : 1,
      completed: Array.isArray(p.completed) ? p.completed : [],
    };
  } catch {
    return FRESH_STATE;
  }
}

function getSnapshot(): TourState {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  // Return a STABLE reference when the stored value hasn't changed — required by
  // useSyncExternalStore to avoid an infinite render loop.
  if (raw === cachedRaw) return cachedState;
  cachedRaw = raw;
  cachedState = parseState(raw);
  return cachedState;
}

function getServerSnapshot(): TourState {
  return SERVER_STATE;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function writeState(next: TourState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — the tour still works this session, just not sticky */
  }
  // Notify same-tab subscribers (the `storage` event only fires cross-tab).
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function pageForPath(pathname: string): StepPage | null {
  if (pathname === "/") return "feed";
  if (pathname.startsWith("/practice/")) return "brief";
  return null;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/** Place the card centred under (or, if it won't fit, above / centred on) the target. */
function placeCard(rect: Rect | null): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));

  if (!rect) {
    return {
      top: clamp((vh - CARD_H_EST) / 2, 8, vh - CARD_H_EST - 8),
      left: clamp((vw - CARD_W) / 2, 8, vw - CARD_W - 8),
    };
  }

  const below = rect.top + rect.height + SPOTLIGHT_PAD + CARD_GAP;
  const above = rect.top - SPOTLIGHT_PAD - CARD_GAP - CARD_H_EST;
  let top: number;
  if (below + CARD_H_EST <= vh - 8) top = below;
  else if (above >= 8) top = above;
  // Target taller than the viewport can hold: pin the card to the bottom so the
  // top of the target (its heading) stays visible rather than being covered.
  else top = Math.max(8, vh - CARD_H_EST - 16);

  const left = clamp(rect.left + rect.width / 2 - CARD_W / 2, 8, vw - CARD_W - 8);
  return { top, left };
}

/** The measured spotlight, tied to the step it belongs to (so a stale rect never shows). */
interface Spot {
  order: number;
  rect: Rect | null;
}

export function OnboardingTour() {
  const pathname = usePathname();
  const router = useRouter();
  const steps = useMemo(() => buildOnboardingSteps(), []);

  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [spot, setSpot] = useState<Spot | null>(null);

  const currentPage = pageForPath(pathname);
  const step = steps.find((s) => s.order === state.step) ?? null;
  const active = state.status === "active" && step != null && step.page === currentPage;

  const skip = useCallback(() => {
    writeState({ ...getSnapshot(), status: "skipped" });
  }, []);

  const advance = useCallback(
    (viaNext: boolean) => {
      const now = getSnapshot();
      const cur = steps.find((s) => s.order === now.step);
      if (!cur) return;

      // Cross-page moves happen only on an explicit "Next →" (an engage click on a
      // real link, e.g. "View brief", lets the link navigate itself). Resolve the
      // destination BEFORE advancing: if it can't resolve — e.g. an empty feed has
      // no brief to open — stay put so this step's card + Skip remain reachable
      // rather than stranding the tour on a page it can't render.
      let navTo: string | null = null;
      if (viaNext && cur.nextHref === "feed") {
        navTo = "/";
      } else if (viaNext && cur.nextHref === "first-brief") {
        const link = document.querySelector<HTMLAnchorElement>('[data-tour="open-brief"] a');
        navTo = link?.getAttribute("href") ?? null;
        if (!navTo) return; // nothing to open — don't advance off this page
      }

      const completed = now.completed.includes(cur.id)
        ? now.completed
        : [...now.completed, cur.id];
      const next = steps.find((s) => s.order === cur.order + 1);
      if (!next) {
        writeState({ status: "done", step: cur.order, completed });
        return;
      }
      writeState({ status: "active", step: next.order, completed });
      if (navTo) router.push(navTo);
    },
    [router, steps],
  );

  // Resolve the current step's target on the current page (setState only in rAF callbacks).
  useEffect(() => {
    if (!active || !step) return;
    if (step.briefMode) {
      window.dispatchEvent(new CustomEvent("bme:brief-mode", { detail: step.briefMode }));
    }

    let raf = 0;
    const started = performance.now();
    const selector = `[data-tour="${step.target}"]`;

    const look = () => {
      const el = document.querySelector(selector);
      if (el) {
        // Scroll so the TARGET + the card below it sit centred as a group — this
        // guarantees the card never covers the element and both stay in view
        // (even for a tall field like the editable email).
        const r = el.getBoundingClientRect();
        const vh = window.innerHeight;
        const groupH = r.height + SPOTLIGHT_PAD * 2 + CARD_GAP + CARD_H_EST;
        const desiredTop =
          groupH <= vh - NAV_OFFSET - 16
            ? Math.max(NAV_OFFSET, (vh - groupH) / 2 + SPOTLIGHT_PAD)
            : NAV_OFFSET;
        window.scrollBy({ top: r.top - desiredTop });
        raf = requestAnimationFrame(() => setSpot({ order: step.order, rect: rectOf(el) }));
        return;
      }
      if (performance.now() - started > TARGET_RETRY_MS) {
        setSpot({ order: step.order, rect: null }); // centred fallback — never dead-end
        return;
      }
      raf = requestAnimationFrame(look);
    };
    raf = requestAnimationFrame(look);

    return () => cancelAnimationFrame(raf);
  }, [active, step]);

  // Keep the spotlight glued to the target as the page scrolls / resizes.
  useEffect(() => {
    if (!active || !step) return;
    const selector = `[data-tour="${step.target}"]`;
    const remeasure = () => {
      const el = document.querySelector(selector);
      if (el) setSpot({ order: step.order, rect: rectOf(el) });
    };
    window.addEventListener("scroll", remeasure, { passive: true, capture: true });
    window.addEventListener("resize", remeasure);
    return () => {
      window.removeEventListener("scroll", remeasure, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", remeasure);
    };
  }, [active, step]);

  // Advance on engaging the real element ("play it").
  useEffect(() => {
    if (!active || !step || step.advance !== "engage") return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t?.closest(`[data-tour="${step.target}"]`)) advance(false);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [active, step, advance]);

  // -- render ----------------------------------------------------------------
  // The finale — a big, centred celebration with confetti sprouting from the card.
  if (state.status === "done" && currentPage != null) {
    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="status">
        <div
          className="absolute inset-0"
          style={{ background: "color-mix(in srgb, var(--color-surface-dark) 55%, transparent)" }}
        />
        <div className="relative">
          {/* confetti burst — in front, exploding out of the card in every direction */}
          <div className="pointer-events-none absolute inset-0 z-20 overflow-visible" aria-hidden="true">
            {CONFETTI.map((p, i) => (
              <span
                key={i}
                className="confetti-piece absolute left-1/2 top-1/2 leading-none"
                style={
                  {
                    // One blast, then gone — `both` keeps pieces hidden during their
                    // delay and holds the finished (invisible) state after.
                    animation: `confetti-burst ${p.dur}s ease-out ${p.delay}s both`,
                    fontSize: `${p.size}px`,
                    "--tx": `${p.tx}px`,
                    "--ty": `${p.ty}px`,
                    "--rot": `${p.rot}deg`,
                  } as React.CSSProperties
                }
              >
                {p.emoji}
              </span>
            ))}
          </div>

          {/* the celebration card — same style as the step cards, bigger + centred */}
          <div className="relative z-10 flex w-[34rem] max-w-[calc(100vw-2rem)] flex-col items-center gap-6 rounded-media bg-surface px-10 py-10 text-center shadow-card">
            <span
              className="flex h-16 w-16 items-center justify-center rounded-pill text-3xl shadow-soft"
              style={{ backgroundImage: gradients.orb }}
            >
              🎉
            </span>
            <div className="flex flex-col gap-1.5">
              <p className="font-display text-h3 font-book tracking-brand text-ink">You Got This.</p>
              <p className="font-display text-h5 text-brand">Go get &apos;em tiger.</p>
            </div>
            <Button variant="primary" size="md" onClick={skip}>
              Let&apos;s go
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!active || !step) return null;

  // The rect only belongs to this step once the effect has measured it; until then
  // (or if the target wasn't found) we centre the card with a full-screen dim.
  const rect = spot && spot.order === step.order ? spot.rect : null;
  const pos = placeCard(rect);
  const isLast = step.order === ONBOARDING_STEP_COUNT;

  return (
    <>
      {/* Dim backdrop + spotlight hole. pointer-events:none => fully non-blocking. */}
      <div className="pointer-events-none fixed inset-0 z-[60]" aria-hidden="true">
        {rect ? (
          <div
            className="absolute rounded-panel transition-all duration-300 ease-out"
            style={{
              top: rect.top - SPOTLIGHT_PAD,
              left: rect.left - SPOTLIGHT_PAD,
              width: rect.width + SPOTLIGHT_PAD * 2,
              height: rect.height + SPOTLIGHT_PAD * 2,
              boxShadow:
                "0 0 0 9999px color-mix(in srgb, var(--color-surface-dark) 62%, transparent), 0 0 0 2px var(--color-brand)",
            }}
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{ background: "color-mix(in srgb, var(--color-surface-dark) 55%, transparent)" }}
          />
        )}
      </div>

      {/* The floating step card. */}
      <div className="fixed z-[70] transition-[top,left] duration-300 ease-out" style={{ top: pos.top, left: pos.left }}>
        <StepCard
          step={step}
          current={step.order}
          total={ONBOARDING_STEP_COUNT}
          isLast={isLast}
          onNext={() => advance(true)}
          onSkip={skip}
        />
      </div>
    </>
  );
}
