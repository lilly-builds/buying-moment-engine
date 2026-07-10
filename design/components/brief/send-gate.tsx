"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, ButtonLink } from "@/design/components";
import { gradients } from "@/design/tokens";
import { StepIcon } from "@/design/components/onboarding/step-icon";
import { DEFAULT_TARGET } from "@/src/target/config";

/**
 * SendGate — the named, routed Send handoff (U17 · CHUNK #3, design §3).
 *
 * The AE's "Send" is not a dead end and not a live send. It is a router to the one
 * person who turns sending on: the RevOps owner (a per-org config value from
 * `src/target/config.ts` — NEVER a hardcoded name). Clicking it opens a gate that:
 *   - names the owner + the one thing they connect ("…once Kyle (RevOps) connects
 *     HubSpot — one time, about 5 minutes."),
 *   - routes in one tap — [Send it to Kyle] or [I have access → steps],
 *   - aggregates demand so the team's pull is visible ("N reps are waiting…"),
 *   - saves the edited draft so nothing is lost while it waits.
 *
 * D9 holds: NOTHING sends. No send API is called. Tapping [Send it to Kyle] only
 * records local demand + saves the draft. Draft-1 stubs the waiting count and keeps
 * state in localStorage (the real per-org demand endpoint is the follow-up).
 */

const DEMAND_KEY = "bme.sendDemand.v1";
const COUNTED_KEY = "bme.sendDemand.counted.v1";
/** A believable starting demand for the demo (design copy: "6 reps are waiting"). */
const DEMAND_BASE = 6;

/** Read the stubbed demand count from localStorage (SSR-safe; falls back to the base). */
function readWaiting(): number {
  try {
    const stored = Number(localStorage.getItem(DEMAND_KEY));
    if (Number.isFinite(stored) && stored > 0) return stored;
  } catch {
    /* ignore */
  }
  return DEMAND_BASE;
}

function readCounted(): boolean {
  try {
    return localStorage.getItem(COUNTED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Save the AE's edited draft so it waits for the connect — reads the real fields. */
function saveDraft() {
  try {
    const fields = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      '[aria-label^="Touch "]',
    );
    const draft: Record<string, string> = {};
    fields.forEach((f) => {
      const label = f.getAttribute("aria-label");
      if (label) draft[label] = f.value;
    });
    localStorage.setItem(`bme.savedDraft.${location.pathname}`, JSON.stringify(draft));
  } catch {
    /* storage unavailable — the handoff still works, the draft just isn't stashed */
  }
}

export function SendGate({ ctaLabel, tourId }: { ctaLabel: string; tourId?: string }) {
  const owner = DEFAULT_TARGET.revOpsOwner;
  const connect = DEFAULT_TARGET.connect;

  const [open, setOpen] = useState(false);
  // Lazy-read from localStorage: these only surface once the modal is opened (a
  // client-only action), so there's no hydration mismatch, and no effect setState.
  const [queued, setQueued] = useState(readCounted);
  const [waiting, setWaiting] = useState(readWaiting);

  // Close on Escape while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const sendToOwner = useCallback(() => {
    saveDraft();
    if (queued) return;
    const next = waiting + 1;
    setWaiting(next);
    setQueued(true);
    try {
      localStorage.setItem(DEMAND_KEY, String(next));
      localStorage.setItem(COUNTED_KEY, "1");
    } catch {
      /* ignore */
    }
  }, [queued, waiting]);

  return (
    <>
      {/* The trigger — opens the handoff. `tourId` marks the one the tour spotlights. */}
      <span data-tour={tourId}>
        <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
          {ctaLabel}
        </Button>
      </span>

      {open ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Turn on sending"
        >
          {/* scrim */}
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default"
            style={{ background: "color-mix(in srgb, var(--color-surface-dark) 62%, transparent)" }}
          />

          <div className="relative flex w-[30rem] max-w-[calc(100vw-2rem)] flex-col gap-5 rounded-media bg-surface p-8 shadow-card">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="absolute right-5 top-5 font-sans text-base text-ink-faint hover:text-ink-muted"
            >
              ✕
            </button>

            {/* orb + key icon — ties the gate to the tour's "Ready to send" step */}
            <span
              className="flex h-14 w-14 items-center justify-center rounded-pill text-white shadow-soft"
              style={{ backgroundImage: gradients.orb }}
            >
              <StepIcon icon="key" />
            </span>

            <div className="flex flex-col gap-2">
              <span className="inline-flex w-fit items-center gap-1.5 rounded-pill border border-health-light px-4 py-1 font-sans text-sm text-health">
                Ready to send
              </span>
              <p className="font-display text-h5 leading-snug tracking-brand text-ink">
                Sending turns on once{" "}
                <span className="font-semibold">
                  {owner.firstName} ({owner.shortRole})
                </span>{" "}
                connects {connect.label}. It&apos;s {connect.effort}.
              </p>
            </div>

            {/* aggregated demand — the team's pull, made visible */}
            <p className="rounded-panel bg-brand-50 p-4 font-sans text-base text-ink">
              {queued
                ? `You're counted. ${owner.firstName} now has ${waiting} reps waiting to send.`
                : `${waiting} reps are waiting on ${owner.firstName} to turn sending on.`}
            </p>

            <p className="font-sans text-sm text-ink-muted">
              {queued
                ? `Your edited draft is saved and waiting. It fires the moment ${owner.firstName} connects.`
                : "Your edited draft saves and waits, so nothing is lost."}
            </p>

            <div className="flex flex-wrap gap-3">
              <Button variant="primary" size="md" onClick={sendToOwner} disabled={queued}>
                {queued ? `Sent to ${owner.firstName} ✓` : `Send it to ${owner.firstName}`}
              </Button>
              <ButtonLink variant="secondary" size="md" href="/integrations">
                I have access → steps
              </ButtonLink>
            </div>

            {/* honest D9 line */}
            <p className="font-sans text-sm text-ink-faint">
              Nothing sends yet. The gate stays off until {owner.firstName} connects {connect.label}.
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
