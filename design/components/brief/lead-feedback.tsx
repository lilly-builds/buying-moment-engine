"use client";

import { useState } from "react";
import { cn } from "@/design/lib/cn";

/**
 * LeadFeedback — the AE's one-tap lead-quality vote (U17 · tour step 6, spec §5 step 10).
 *
 * "Good lead? Tap the thumb." A 👍/👎 that teaches the tool which leads are worth
 * the AE's time — and the tour's "Teach it" target. Draft-1 keeps the verdict in
 * client state; the `feedback` table + `/api/feedback` persistence is the
 * productionization follow-up (the route is a stub today). Kept honest: it does
 * not claim to have saved anything server-side.
 */

type Verdict = "up" | "down";

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

export function LeadFeedback({ className }: { className?: string }) {
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  return (
    <div
      data-tour="rate-lead"
      className={cn(
        "flex flex-wrap items-center justify-between gap-4 rounded-card bg-surface-card px-6 py-4",
        className,
      )}
    >
      <span className="font-sans text-base text-ink">
        {verdict
          ? "Thanks. That teaches the tool what a good lead looks like."
          : "Was this a good lead?"}
      </span>
      <div className="flex items-center gap-2">
        <ThumbButton value="up" active={verdict === "up"} onClick={() => setVerdict("up")} />
        <ThumbButton value="down" active={verdict === "down"} onClick={() => setVerdict("down")} />
      </div>
    </div>
  );
}
