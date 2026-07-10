/**
 * src/onboarding/spotlight.ts — the shared spotlight-tour primitives.
 *
 * Pure, framework-light helpers behind BOTH coach-throughs: the AE "work your
 * first lead" tour (`app/onboarding/onboarding-tour.tsx`) and the RevOps "connect
 * your stack" tour (`app/onboarding/revops-tour.tsx`). Sharing them here is the
 * whole point of Thread 08's rework — the RevOps onboarding spotlights, places its
 * card, and remembers progress with the SAME code the AE tour uses, so it looks
 * and behaves identically.
 *
 * Everything here is DOM-measuring or localStorage-backed but UI-agnostic; the
 * React controllers compose these into the actual tour.
 */

// ── geometry (the spotlight + floating-card math) ─────────────────────────────

/** Padding around the spotlit element, and the gap between it and the card. */
export const SPOTLIGHT_PAD = 12;
export const CARD_GAP = 16;
/** The card is a fixed width (`w-[32rem]`); an estimate of its height suffices
 *  (generous, so the taller cards that carry a supporting sentence still clear). */
export const CARD_W = 512;
export const CARD_H_EST = 300;
/** Keep the sticky nav clear when scrolling a target into place. */
export const NAV_OFFSET = 88;
/** How long to keep looking for a step's target before falling back to a centred card. */
export const TARGET_RETRY_MS = 2500;

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/** Place the card centred under (or, if it won't fit, above / centred on) the target. */
export function placeCard(rect: Rect | null): { top: number; left: number } {
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
  // top of the target stays visible rather than being covered.
  else top = Math.max(8, vh - CARD_H_EST - 16);

  const left = clamp(rect.left + rect.width / 2 - CARD_W / 2, 8, vw - CARD_W - 8);
  return { top, left };
}

// ── progress store (localStorage-backed, one per tour) ────────────────────────

export type TourStatus = "active" | "done" | "skipped";

export interface TourState {
  status: TourStatus;
  /** The `order` of the current step. */
  step: number;
  completed: string[];
}

export interface TourStore {
  getSnapshot: () => TourState;
  getServerSnapshot: () => TourState;
  subscribe: (onChange: () => void) => () => void;
  write: (next: TourState) => void;
}

const FRESH_STATE: TourState = { status: "active", step: 1, completed: [] };
/** On the server (and during hydration) nothing renders — the real state loads after. */
const SERVER_STATE: TourState = { status: "skipped", step: 1, completed: [] };

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

/**
 * A localStorage-backed external store for ONE tour's progress. Each tour passes
 * its own storage key, so the AE and RevOps tours never clobber each other's
 * progress. Snapshots are returned by STABLE reference when the stored value is
 * unchanged — required by `useSyncExternalStore` to avoid an infinite render loop.
 */
export function createTourStore(storageKey: string): TourStore {
  const changeEvent = `bme:tour-change:${storageKey}`;
  let cachedRaw: string | null = null;
  let cachedState: TourState = FRESH_STATE;

  function getSnapshot(): TourState {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(storageKey);
    } catch {
      raw = null;
    }
    if (raw === cachedRaw) return cachedState;
    cachedRaw = raw;
    cachedState = parseState(raw);
    return cachedState;
  }

  function getServerSnapshot(): TourState {
    return SERVER_STATE;
  }

  function subscribe(onChange: () => void): () => void {
    window.addEventListener(changeEvent, onChange);
    // The native `storage` event only fires cross-tab; the custom event covers same-tab.
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(changeEvent, onChange);
      window.removeEventListener("storage", onChange);
    };
  }

  function write(next: TourState) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* storage unavailable — the tour still works this session, just not sticky */
    }
    window.dispatchEvent(new Event(changeEvent));
  }

  return { getSnapshot, getServerSnapshot, subscribe, write };
}
