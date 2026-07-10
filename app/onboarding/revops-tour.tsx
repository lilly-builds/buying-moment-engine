"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/design/components";
import { gradients } from "@/design/tokens";
import { StepCard } from "@/design/components/onboarding/step-card";
import { StepIcon } from "@/design/components/onboarding/step-icon";
import { SpotlightOverlay } from "@/design/components/onboarding/spotlight-overlay";
import {
  CARD_GAP,
  CARD_H_EST,
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

function pageForPath(pathname: string): RevopsTourPage | null {
  if (pathname === "/" || pathname === "/styleguide/feed") return "feed";
  if (pathname.startsWith("/practice/") || pathname === "/styleguide/brief") return "brief";
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

  const currentPage = pageForPath(pathname);
  const step = steps.find((s) => s.order === state.step) ?? null;
  const active = state.status === "active" && step != null && step.page === currentPage;

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

  // Flip the brief tier (if needed) and resolve this step's target on the page.
  useEffect(() => {
    if (!active || !step) return;
    if (step.briefMode) {
      window.dispatchEvent(new CustomEvent("bme:brief-mode", { detail: step.briefMode }));
    }
    if (!step.target) {
      // Centred card, full dim. Defer to a rAF so we never setState synchronously
      // in the effect body (cascading-render lint rule + matches the target path).
      const centre = requestAnimationFrame(() => setSpot({ order: step.order, rect: null }));
      return () => cancelAnimationFrame(centre);
    }

    let raf = 0;
    const started = performance.now();
    const selector = `[data-tour="${step.target}"]`;

    const look = () => {
      const el = document.querySelector(selector);
      if (el) {
        // Scroll so the target + the card below it sit centred as a group — the
        // card never covers the element and both stay in view.
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
    if (!active || !step || !step.target) return;
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

  // "Play it": clicking the spotlit element on a cross-page step advances the tour
  // AND takes it to the right page (we route it ourselves so it works on the
  // styleguide previews too, where the real link points at an auth-gated route).
  useEffect(() => {
    if (!active || !step || !step.target || !step.nav) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t?.closest(`[data-tour="${step.target}"]`)) {
        e.preventDefault();
        e.stopPropagation();
        advance();
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [active, step, advance]);

  // -- render ----------------------------------------------------------------
  // The finale — shown on the integrations page once the walk is done.
  if (state.status === "done" && currentPage === "integrations") {
    return <RevopsFinale onClose={skip} />;
  }

  if (!active || !step) return null;

  // The rect only belongs to this step once the effect has measured it; until then
  // (or if the target wasn't found) the card centres with a full-screen dim.
  const rect = spot && spot.order === step.order ? spot.rect : null;
  const pos = placeCard(rect);
  const isLast = step.order === REVOPS_TOUR_STEP_COUNT;

  return (
    <>
      <SpotlightOverlay rect={rect} />
      <div
        className="fixed z-[70] transition-[top,left] duration-300 ease-out"
        style={{ top: pos.top, left: pos.left }}
      >
        <StepCard
          step={step}
          current={step.order}
          total={REVOPS_TOUR_STEP_COUNT}
          isLast={isLast}
          onNext={advance}
          onSkip={skip}
        />
      </div>
    </>
  );
}

/**
 * The finale — a centred celebration on the integrations page. Honest by design
 * (D9): it does NOT claim "you're live" (that would be false until the real
 * connections are made). It hands them straight to the three connections, which
 * carry their own real Connected / Not-yet status.
 */
function RevopsFinale({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="status">
      <div
        className="absolute inset-0"
        style={{ background: "color-mix(in srgb, var(--color-surface-dark) 55%, transparent)" }}
      />
      <div className="relative z-10 flex w-[34rem] max-w-[calc(100vw-2rem)] flex-col items-center gap-6 rounded-media bg-surface px-10 py-10 text-center shadow-card">
        <span
          className="flex h-16 w-16 items-center justify-center rounded-pill text-white shadow-soft"
          style={{ backgroundImage: gradients.orb }}
        >
          <StepIcon icon="key" />
        </span>
        <div className="flex flex-col gap-1.5">
          <p className="font-display text-h3 font-book tracking-brand text-ink">
            That&apos;s the whole tool.
          </p>
          <p className="font-display text-h5 text-brand">
            Connect the three below and your team is live.
          </p>
        </div>
        <Button variant="primary" size="md" onClick={onClose}>
          Start connecting
        </Button>
      </div>
    </div>
  );
}
