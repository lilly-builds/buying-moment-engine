"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/design/components";
import { gradients } from "@/design/tokens";
import { StepCard } from "@/design/components/onboarding/step-card";
import { StepIcon } from "@/design/components/onboarding/step-icon";
import { SpotlightOverlay } from "@/design/components/onboarding/spotlight-overlay";
import {
  CARD_GAP,
  CARD_H_EST,
  NAV_BAR_HEIGHT,
  NAV_OFFSET,
  SPOTLIGHT_PAD,
  TARGET_RETRY_MS,
  createTourStore,
  placeCard,
  rectOf,
  type Rect,
} from "@/src/onboarding/spotlight";
import {
  REVOPS_TOUR_STEPS,
  REVOPS_TOUR_STEP_COUNT,
  type RevopsTourPage,
} from "@/src/onboarding/integrations-tour-steps";

/**
 * RevopsTour — the RevOps "connect your stack" coach-through (Thread 08).
 *
 * The SAME spotlight tour the AE gets (`onboarding-tour.tsx`), pointed at the
 * RevOps journey: it dims the page and spotlights ONE real element per step,
 * floats the brand StepCard beside it, and walks feed → brief → integrations so
 * the leader SEES the value (on the real feed + brief) before landing on the three
 * connections that turn it on. Reuses the shared engine (`src/onboarding/
 * spotlight.ts`) + StepCard + the feed/brief `data-tour` hooks already in place.
 *
 * Mounted once in the root layout (so it survives the cross-page walk). Progress
 * persists in localStorage under its OWN key, read through `useSyncExternalStore`
 * so it's SSR-safe. Fully SKIPPABLE + NON-BLOCKING (the dim backdrop is
 * pointer-events:none, so HubSpot's real Connect button underneath still works).
 *
 * Also runs on the public `/styleguide/*` previews (feed/brief/integrations) so
 * the whole flow is reviewable with no login — nav resolves to the styleguide
 * equivalents there.
 *
 * NOTE (targeting follow-up): this build mounts the RevOps tour in place of the AE
 * tour. Production would pick per archetype (AE → onboarding-tour, RevOps → this),
 * the same way the AE tour's per-user `onboarding_state` table is a follow-up.
 */

const store = createTourStore("bme.revops-onboarding.v1");

/**
 * Resolve a `data-tour` selector to the element that's actually on screen. A hook
 * can render in two places across breakpoints — the Scoreboard link lives in both
 * the desktop top bar and the mobile bottom tab bar (one hidden at any width) — and
 * a plain `querySelector` would grab whichever comes first in the DOM, sometimes the
 * `display:none` one (a 0×0 rect that puts the spotlight in the corner). Prefer the
 * first match with a real box; fall back to the first node so callers never dead-end.
 */
function visibleTarget(selector: string): Element | null {
  const els = document.querySelectorAll(selector);
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return els[0] ?? null;
}

function pageForPath(pathname: string): RevopsTourPage | null {
  if (pathname === "/" || pathname === "/styleguide/feed") return "feed";
  if (pathname.startsWith("/practice/") || pathname === "/styleguide/brief") return "brief";
  if (pathname === "/scoreboard" || pathname === "/styleguide/scoreboard") return "scoreboard";
  if (pathname === "/integrations" || pathname === "/styleguide/integrations") return "integrations";
  return null;
}

/** The measured spotlight, tied to the step it belongs to (so a stale rect never shows). */
interface Spot {
  order: number;
  rect: Rect | null;
}

export function RevopsTour() {
  const pathname = usePathname();
  const router = useRouter();
  const steps = REVOPS_TOUR_STEPS;
  const isStyleguide = pathname.startsWith("/styleguide");

  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const [spot, setSpot] = useState<Spot | null>(null);
  // The card's REAL height, measured from the rendered node. Placement needs the
  // truth (not the estimate) or a tall card's controls get clipped off the bottom.
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(CARD_H_EST);
  // sm:+ floats the card beside its target (the placement math below assumes a
  // floating card); under sm the StepCard is a full-width bottom sheet, so we skip
  // that math and let its own sheet styles pin it to the bottom of the viewport.
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const currentPage = pageForPath(pathname);
  const step = steps.find((s) => s.order === state.step) ?? null;
  const active = state.status === "active" && step != null && step.page === currentPage;

  const spotlightTarget = step?.target ?? null;

  // The Scoreboard-nav transition step points AT the nav button. On desktop that
  // button is in the top bar; on a PHONE it's in the fixed BOTTOM bar. So on mobile
  // this step must point DOWN, not up: we still spotlight the real tab (the ring
  // lands on the bottom-bar Scoreboard via `visibleTarget`), skip the scroll a fixed
  // target doesn't need, and float the card ABOVE the bar so it never covers the
  // thing it's highlighting. `visibleTarget` resolves the top vs bottom instance.
  const isBottomNavStep =
    active && !isDesktop && step?.target === "nav-scoreboard";

  const skip = useCallback(() => {
    store.write({ ...store.getSnapshot(), status: "skipped" });
  }, []);

  const advance = useCallback(() => {
    const now = store.getSnapshot();
    const cur = steps.find((s) => s.order === now.step);
    if (!cur) return;

    // Resolve any cross-page destination BEFORE advancing (styleguide → the public
    // previews; live app → the real routes). If a live "first-brief" can't resolve
    // — e.g. an empty feed — stay put so this card + Skip stay reachable.
    let navTo: string | null = null;
    if (cur.nav === "first-brief") {
      if (isStyleguide) {
        navTo = "/styleguide/brief";
      } else {
        const link = document.querySelector<HTMLAnchorElement>('[data-tour="open-brief"] a');
        navTo = link?.getAttribute("href") ?? null;
        if (!navTo) return;
      }
    } else if (cur.nav === "scoreboard") {
      navTo = isStyleguide ? "/styleguide/scoreboard" : "/scoreboard";
    } else if (cur.nav === "integrations") {
      navTo = isStyleguide ? "/styleguide/integrations" : "/integrations";
    }

    const completed = now.completed.includes(cur.id)
      ? now.completed
      : [...now.completed, cur.id];
    const next = steps.find((s) => s.order === cur.order + 1);
    if (!next) {
      store.write({ status: "done", step: cur.order, completed });
      return;
    }
    store.write({ status: "active", step: next.order, completed });
    if (navTo) router.push(navTo);
  }, [router, steps, isStyleguide]);

  // Replay entry point: visiting any page with `?tour=replay` restarts the tour from
  // step 1 on the feed (a "take the tour again" link points here). It resets
  // progress, then lands on the feed where step 1 lives — on the styleguide previews
  // too. The `?tour=replay` guard makes re-runs after the redirect a no-op (the param
  // is gone), so no dependency needs excluding.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tour") !== "replay") return;
    store.write({ status: "active", step: 1, completed: [] });
    router.replace(isStyleguide ? "/styleguide/feed" : "/");
  }, [router, isStyleguide]);

  // Flip the brief tier (if needed) and resolve this step's target on the page.
  useEffect(() => {
    if (!active || !step) return;
    if (step.briefMode) {
      window.dispatchEvent(new CustomEvent("bme:brief-mode", { detail: step.briefMode }));
    }
    if (!spotlightTarget) {
      // Centred card, full dim. Defer to a rAF so we never setState synchronously
      // in the effect body (cascading-render lint rule + matches the target path).
      const centre = requestAnimationFrame(() => setSpot({ order: step.order, rect: null }));
      return () => cancelAnimationFrame(centre);
    }

    let raf = 0;
    const started = performance.now();
    const selector = `[data-tour="${spotlightTarget}"]`;

    const look = () => {
      const el = visibleTarget(selector);
      if (el) {
        const r = el.getBoundingClientRect();
        const vh = window.innerHeight;
        // A fixed bottom-nav target is always on-screen — scrolling toward it would
        // only jostle the page (the element never moves), so leave the page put.
        if (isBottomNavStep) {
          raf = requestAnimationFrame(() => setSpot({ order: step.order, rect: rectOf(el) }));
          return;
        }
        if (r.top < NAV_BAR_HEIGHT) {
          // A sticky NAV link (a transition step pointing "up in your nav"): scroll
          // the page to the very top so the nav sits on its own dark hero and its
          // text stays readable — over light mid-page content the white nav links
          // wash out. Instant, not smooth: a smooth scroll here gets cancelled
          // mid-flight (competing measures) and snaps back. The link is sticky, so
          // this never moves the target itself.
          if (window.scrollY > 0) window.scrollTo({ top: 0 });
        } else {
          // If the target is already fully on-screen with room for the card below
          // it, DON'T scroll: it only jostles the page and can flash a stale rect.
          const groupBottom = r.top + r.height + SPOTLIGHT_PAD + CARD_GAP + CARD_H_EST;
          const alreadyPlaced = r.top >= 0 && r.bottom <= vh && groupBottom <= vh - 8;
          if (!alreadyPlaced) {
            // Scroll so the target + the card below it sit centred as a group — the
            // card never covers the element and both stay in view.
            const groupH = r.height + SPOTLIGHT_PAD * 2 + CARD_GAP + CARD_H_EST;
            const desiredTop =
              groupH <= vh - NAV_OFFSET - 16
                ? Math.max(NAV_OFFSET, (vh - groupH) / 2 + SPOTLIGHT_PAD)
                : NAV_OFFSET;
            window.scrollBy({ top: r.top - desiredTop });
          }
        }
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
  }, [active, step, spotlightTarget, isBottomNavStep]);

  // Keep the spotlight glued to the target as the page scrolls / resizes.
  useEffect(() => {
    if (!active || !step || !spotlightTarget) return;
    const selector = `[data-tour="${spotlightTarget}"]`;
    const remeasure = () => {
      const el = visibleTarget(selector);
      if (el) setSpot({ order: step.order, rect: rectOf(el) });
    };
    window.addEventListener("scroll", remeasure, { passive: true, capture: true });
    window.addEventListener("resize", remeasure);
    return () => {
      window.removeEventListener("scroll", remeasure, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", remeasure);
    };
  }, [active, step, spotlightTarget]);

  // "Play it": clicking the spotlit element on a cross-page step advances the tour
  // AND takes it to the right page (we route it ourselves so it works on the
  // styleguide previews too, where the real link points at an auth-gated route).
  useEffect(() => {
    if (!active || !step || !spotlightTarget || !step.engage) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t?.closest(`[data-tour="${spotlightTarget}"]`)) {
        e.preventDefault();
        e.stopPropagation();
        advance();
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [active, step, spotlightTarget, advance]);

  // Measure the rendered card so placement uses its real height. useLayoutEffect
  // runs before paint, so the card lands in its correct (fully-visible) spot on the
  // first frame — no flash from the estimate, no cut-off controls to scroll to.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const h = Math.round(el.getBoundingClientRect().height);
    if (h > 0 && h !== cardH) setCardH(h);
    // Re-measure whenever the step or its spot changes (the card's content, hence
    // its height, changes with it); `cardH` guards against a re-render loop.
  }, [step, spot, cardH]);

  // -- render ----------------------------------------------------------------
  // The finale — shown on the integrations page once the walk is done.
  if (state.status === "done" && currentPage === "integrations") {
    return <RevopsFinale onClose={skip} />;
  }

  if (!active || !step) return null;

  // The rect only belongs to this step once the effect has measured it; until then
  // (or if the target wasn't found) the card centres with a full-screen dim.
  const rect = spot && spot.order === step.order ? spot.rect : null;
  const pos = placeCard(rect, cardH);
  const isLast = step.order === REVOPS_TOUR_STEP_COUNT;

  return (
    <>
      <SpotlightOverlay rect={rect} />
      <div
        ref={cardRef}
        className={`fixed z-[70] ${
          isDesktop
            ? "transition-[top,left] duration-300 ease-out"
            : isBottomNavStep
              ? // Float ABOVE the bottom bar so the spotlit Scoreboard tab stays
                // visible below the card it points to (clears bar + ring + a gap).
                "inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))]"
              : "inset-x-0 bottom-0"
        }`}
        style={isDesktop ? { top: pos.top, left: pos.left } : undefined}
      >
        <StepCard
          step={step}
          current={step.order}
          total={REVOPS_TOUR_STEP_COUNT}
          isLast={isLast}
          floating={isBottomNavStep}
          onNext={advance}
          onSkip={skip}
        />
      </div>
    </>
  );
}

/**
 * The finale — a centred icon + "Start connecting" button on the integrations
 * page (no copy: the walk already made the pitch). Honest by design (D9): it makes
 * no "you're live" claim (false until the real connections are made). "Start
 * connecting" dismisses it AND scrolls up to the HubSpot row (the first
 * connection), so they land right where they act.
 */
function RevopsFinale({ onClose }: { onClose: () => void }) {
  const startConnecting = () => {
    onClose();
    const el = document.querySelector('[data-tour="connect-hubspot"]');
    if (el) {
      const y = el.getBoundingClientRect().top + window.scrollY - NAV_OFFSET;
      window.scrollTo({ top: y, behavior: "smooth" });
    }
  };
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="status">
      <div
        className="absolute inset-0"
        style={{ background: "color-mix(in srgb, var(--color-surface-dark) 55%, transparent)" }}
      />
      <Button
        variant="primary-dark"
        size="lg"
        onClick={startConnecting}
        className="relative z-10 shadow-card"
      >
        <span
          className="flex h-7 w-7 items-center justify-center rounded-pill text-white"
          style={{ backgroundImage: gradients.orb }}
        >
          <StepIcon icon="key" className="h-4 w-4" />
        </span>
        Start connecting
      </Button>
    </div>
  );
}
