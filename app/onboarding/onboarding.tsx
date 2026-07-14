"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/design/components";
import { gradients } from "@/design/tokens";
import { RevopsTour, restartRevopsTour } from "./revops-tour";
import { OnboardingTour, restartOnboardingTour } from "./onboarding-tour";

/**
 * Onboarding orchestrator — the single front door to onboarding (D14 archetypes).
 *
 * The app ships TWO coach-throughs — the AE "work your first lead" walk
 * (`OnboardingTour`) and the RevOps "connect your stack" walk (`RevopsTour`) — but
 * nothing in the product knew WHICH one a visitor should get (there is no role on
 * the account; auth is a flat email allowlist). Before this, the layout mounted the
 * RevOps walk for everyone, so an AE was coached through connecting HubSpot — not
 * their job per D14.
 *
 * This component asks once, on the first visit to the feed, then routes to the
 * matching tour and remembers the answer (localStorage, per-browser — the same
 * draft-1 persistence the tours use; a per-user `onboarding_role` column is the
 * productionization follow-up, not this change). Picking a role writes it, which
 * re-renders here and mounts the chosen tour; that tour then auto-starts on the
 * feed exactly as it did before. Only ONE tour is ever mounted, so neither can
 * auto-start until the visitor has chosen — the chooser is the gate.
 *
 * Non-blocking + skippable, like the tours: "I'll look around on my own" records
 * `skipped` so the card never returns and no tour runs. To re-open it, clear the
 * `bme.onboarding-role.v1` key.
 */

const ROLE_KEY = "bme.onboarding-role.v1";
const ROLE_CHANGE_EVENT = "bme:onboarding-role-change";

export type OnboardingRole = "ae" | "revops" | "skipped";

/**
 * In-memory fallback for this session. The chooser is a full-screen modal, and its
 * ONLY dismissal path is the role going non-null. If `localStorage.setItem` throws
 * (Safari private mode, quota, or storage blocked), a persistence-only store would
 * re-read `null` after every pick and trap the user behind an undismissable card.
 * `writeRole` always records the choice here first, so a storage failure degrades to
 * "holds this session, just doesn't persist across reloads" — never a lockout.
 */
let memoryRole: OnboardingRole | null = null;

function readRole(): OnboardingRole | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(ROLE_KEY);
  } catch {
    raw = null;
  }
  if (raw === "ae" || raw === "revops" || raw === "skipped") return raw;
  // Storage empty or unreadable — fall back to the in-session choice.
  return memoryRole;
}

/**
 * SSR + the first client (hydration) render return `undefined`, so the orchestrator
 * renders nothing on the server and during hydration — no flash of the chooser for
 * a returning visitor who already chose. After hydration `useSyncExternalStore`
 * swaps to `readRole` and the real state takes over.
 */
function serverRole(): OnboardingRole | null | undefined {
  return undefined;
}

function subscribeRole(onChange: () => void): () => void {
  window.addEventListener(ROLE_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(ROLE_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function writeRole(role: OnboardingRole): void {
  // Picking a role is the front door to onboarding, so start the chosen tour from the
  // top. Each tour keeps its progress under a SEPARATE key from this chooser, and a
  // prior session may have left it `done`/`skipped` (or parked mid-walk on a later
  // page) — any of which would make the mounted tour render nothing and the pick appear
  // to do nothing. Restart it BEFORE we flip the role, so the tour reads a fresh step-1
  // state when it mounts. "Skipped" starts no tour, so it needs no restart.
  if (role === "ae") restartOnboardingTour();
  if (role === "revops") restartRevopsTour();
  // Record in memory FIRST, so the choice holds even if persistence throws below.
  memoryRole = role;
  try {
    localStorage.setItem(ROLE_KEY, role);
  } catch {
    // Storage unavailable (private mode / quota). The choice still holds this
    // session via `memoryRole`; it just won't persist across reloads.
    if (typeof console !== "undefined") {
      console.warn(
        "[onboarding] couldn't persist the role choice to localStorage; holding it in memory for this session.",
      );
    }
  }
  // The `storage` event only fires cross-tab; notify this tab directly.
  window.dispatchEvent(new Event(ROLE_CHANGE_EVENT));
}

interface RoleOption {
  role: "ae" | "revops";
  title: string;
  blurb: string;
}

const OPTIONS: RoleOption[] = [
  {
    role: "ae",
    title: "Account executive / sales rep",
    blurb: "Work a lead end to end — read the brief, tweak the outreach, send it.",
  },
  {
    role: "revops",
    title: "RevOps leader / software admin",
    blurb: "Connect your stack so every lead your team works is tracked in one place.",
  },
];

export function Onboarding() {
  const pathname = usePathname();
  const role = useSyncExternalStore<OnboardingRole | null | undefined>(
    subscribeRole,
    readRole,
    serverRole,
  );

  // The styleguide keeps its existing design-preview behaviour (the RevOps walk over
  // the component previews), untouched by the role gate.
  if (pathname.startsWith("/styleguide")) return <RevopsTour />;

  if (role === undefined) return null; // SSR / pre-hydration — render nothing
  if (role === "ae") return <OnboardingTour />;
  if (role === "revops") return <RevopsTour />;
  if (role === "skipped") return null;

  // role === null (never chosen). The chooser is the front door, shown where both
  // tours begin — the feed — so the chosen tour starts the instant they pick.
  if (pathname !== "/") return null;
  return <RoleChooser onChoose={writeRole} />;
}

function RoleChooser({ onChoose }: { onChoose: (role: OnboardingRole) => void }) {
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-role-title"
    >
      <div
        className="absolute inset-0"
        style={{ background: "color-mix(in srgb, var(--color-surface-dark) 55%, transparent)" }}
      />
      <div className="relative z-10 flex w-[34rem] max-w-[calc(100vw-2rem)] flex-col gap-6 rounded-media bg-surface p-8 shadow-card">
        <div className="flex flex-col items-center gap-4 text-center">
          <span
            className="flex h-16 w-16 items-center justify-center rounded-pill text-3xl shadow-soft"
            style={{ backgroundImage: gradients.orb }}
            aria-hidden="true"
          >
            👋
          </span>
          <div className="flex flex-col items-center gap-1.5">
            <p className="font-sans text-sm font-medium uppercase tracking-eyebrow text-eyebrow">
              Welcome to GTM Maestro
            </p>
            <h2
              id="onboarding-role-title"
              className="font-display text-h4 font-book tracking-brand text-ink"
            >
              Are you using this as a…
            </h2>
            <p className="max-w-text font-sans text-sm text-ink-muted">
              Pick one and we&rsquo;ll tailor a quick tour. You can skip it any time.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {OPTIONS.map((option) => (
            <button
              key={option.role}
              type="button"
              onClick={() => onChoose(option.role)}
              className="flex w-full flex-col items-start gap-1 rounded-panel border border-line-outline bg-surface px-5 py-4 text-left transition-colors hover:border-line-outline-hover hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <span className="font-display text-h5 text-ink">{option.title}</span>
              <span className="font-sans text-sm text-ink-muted">{option.blurb}</span>
            </button>
          ))}
        </div>

        <div className="flex justify-center">
          <Button variant="tertiary" size="sm" onClick={() => onChoose("skipped")}>
            I&rsquo;ll look around on my own
          </Button>
        </div>
      </div>
    </div>
  );
}
