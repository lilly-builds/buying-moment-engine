"use client";

import { useState } from "react";
import { cn } from "@/design/lib/cn";

/**
 * LeadFeedback — the AE's one-tap lead-quality vote (U17 · tour step 6, spec §5 step 10).
 *
 * "Good lead? Tap the thumb." A 👍/👎 that teaches the tool which leads are worth
 * the AE's time, and the tour's "Teach it" target. The vote persists to the
 * `feedback` table via `/api/feedback` (COV-11); it stays honest about the save,
 * confirming only after the request succeeds and showing an error if it does not.
 */

type Verdict = "up" | "down";
type SaveState = "idle" | "saving" | "saved" | "error";

function ThumbButton({
  value,
  active,
  onClick,
}: {
  value: Verdict;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={value === "up" ? "Good lead" : "Not a good lead"}
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-pill border text-lg transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        active
          ? "border-brand bg-brand-50"
          : "border-line-outline bg-surface hover:border-line-outline-hover",
      )}
    >
      <span aria-hidden="true">{value === "up" ? "👍" : "👎"}</span>
    </button>
  );
}

export function LeadFeedback({
  practiceId,
  className,
}: {
  practiceId: string;
  className?: string;
}) {
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [state, setState] = useState<SaveState>("idle");

  async function vote(thumb: Verdict) {
    setVerdict(thumb);
    setState("saving");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ practiceId, thumb }),
      });
      setState(res.ok ? "saved" : "error");
    } catch {
      setState("error");
    }
  }

  const message =
    state === "error"
      ? "Could not save that. Tap again to retry."
      : state === "saved"
        ? "Thanks. That teaches the tool what a good lead looks like."
        : state === "saving"
          ? "Saving…"
          : "Was this a good lead?";

  return (
    <div
      data-tour="rate-lead"
      className={cn(
        "flex flex-wrap items-center justify-between gap-4 rounded-card bg-surface-card px-6 py-4",
        className,
      )}
    >
      {/* role=status so the save outcome is announced to assistive tech. */}
      <span className="font-sans text-base text-ink" role="status">
        {message}
      </span>
      <div className="flex items-center gap-2">
        <ThumbButton value="up" active={verdict === "up"} onClick={() => vote("up")} />
        <ThumbButton value="down" active={verdict === "down"} onClick={() => vote("down")} />
      </div>
    </div>
  );
}
