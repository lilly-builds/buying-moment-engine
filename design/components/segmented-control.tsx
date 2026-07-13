"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/design/lib/cn";

/**
 * SegmentedControl (U2 / R15) — shared by U8's vertical filter and U12's
 * scoreboard aggregate/per-vertical toggle.
 *
 * INFERRED, and honestly so: EliseAI ships no segmented control. This is built
 * from their verified pill system — a `#f5f5f7` rounded-full track with an
 * active segment in brand purple (or health blue). It is the one component in
 * this kit with no source rule behind it, and the one most worth eyeballing.
 *
 * Controlled by design. The consumer owns where the value lives — U8 wants it in
 * the URL (a shareable filtered feed), U12 wants it in local state. A component
 * that picked one would be wrong for the other.
 *
 * Generic over the value so callers keep their union type end-to-end:
 *   <SegmentedControl<Vertical> options={VERTICALS} value={v} onValueChange={setV} />
 */

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  /** `health` tints the active segment blue — use it on healthcare-vertical filters. */
  accent?: "brand" | "health";
  size?: "sm" | "md";
  /**
   * A few options that should read as a TOGGLE (e.g. the brief's Send / Prep) —
   * on a phone the track spans the full width and the segments split it evenly, so
   * it lands as one thumb-wide switch rather than two small pills adrift in a row.
   * Desktop is unchanged (the track hugs its content). Leave off for many-option
   * FILTERS: those stay natural-width and scroll horizontally when they can't fit.
   */
  fill?: boolean;
  /** Required: a radiogroup with no accessible name is unusable by screen reader. */
  label: string;
  className?: string;
}

const SIZES = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-base",
} as const;

export function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  accent = "brand",
  size = "md",
  fill = false,
  label,
  className,
}: SegmentedControlProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  // The scroll track (filter mode) + whether more options sit off the right edge,
  // so a phone user gets a fade + chevron that says "this row scrolls" instead of
  // guessing the visible options are all of them.
  const trackRef = useRef<HTMLDivElement>(null);
  const [scrollHint, setScrollHint] = useState(false);

  const syncScrollHint = useCallback(() => {
    const el = trackRef.current;
    setScrollHint(!!el && el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
  }, []);

  useEffect(() => {
    if (fill) return;
    syncScrollHint();
    const el = trackRef.current;
    if (!el) return;
    el.addEventListener("scroll", syncScrollHint, { passive: true });
    window.addEventListener("resize", syncScrollHint);
    return () => {
      el.removeEventListener("scroll", syncScrollHint);
      window.removeEventListener("resize", syncScrollHint);
    };
  }, [fill, syncScrollHint, options.length]);

  // If `value` matches no option (a stale URL param, say), the group would have
  // no tabbable child and drop out of the tab order entirely. Fall back to the
  // first segment as the tab stop — nothing renders as selected, but the control
  // stays reachable.
  const selectedIndex = options.findIndex((o) => o.value === value);
  const tabStopIndex = selectedIndex >= 0 ? selectedIndex : 0;

  function move(from: number, delta: number) {
    if (options.length === 0) return;
    const next = (from + delta + options.length) % options.length;
    onValueChange(options[next].value);
    refs.current[next]?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        move(index, 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        move(index, -1);
        break;
      case "Home":
        event.preventDefault();
        move(0, 0);
        break;
      case "End":
        event.preventDefault();
        move(options.length - 1, 0);
        break;
    }
  }

  return (
    <div className={cn("relative w-full min-w-0 max-w-full sm:w-fit", className)}>
      <div
      ref={trackRef}
      role="radiogroup"
      aria-label={label}
      className={cn(
        "flex items-center gap-1 rounded-pill bg-surface-subtle p-1",
        // `w-fit` (sm:+) hugs the pills; `max-w-full` + `min-w-0` cap the track at
        // its container at EVERY width so it can never push the page wide — and
        // `overflow-x-auto` scrolls the pills when capped. `min-w-0` is load-bearing
        // on Safari: without it a flex track with overflowing content expands to its
        // content width instead of scrolling, which is exactly the horizontal-overflow
        // this caused. `shrink-0` pills (below) keep full size and scroll.
        fill
          ? // TOGGLE — span the row and let the segments share it evenly below.
            "w-full min-w-0 max-w-full sm:w-fit"
          : // FILTER — full width, capped, scrolls (the 5-option track is ~630px,
            // wider than any phone and than a narrow tablet row beside the title).
            "w-full min-w-0 max-w-full snap-x overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:w-fit",
      )}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            // Roving tabindex: the group is one tab stop; arrows move within it.
            tabIndex={index === tabStopIndex ? 0 : -1}
            onClick={() => onValueChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "snap-start rounded-pill font-sans font-book tracking-control whitespace-nowrap transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
              // TOGGLE splits the phone track evenly (`flex-1`), then hugs on desktop.
              // FILTER keeps each pill full-size so the track scrolls instead of squishing.
              fill ? "flex-1 sm:flex-none" : "shrink-0",
              SIZES[size],
              selected
                ? accent === "health"
                  ? "bg-health text-white"
                  : "bg-brand text-white"
                : "bg-transparent text-ink-body hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
      </div>

      {/* Scroll affordance (filter mode, phone only): a fade into the track colour
          plus a chevron at the right edge, shown only while more options sit
          off-screen to the right. It hides the moment the row is scrolled to the
          end, and never shows on desktop (the track hugs its content there). */}
      {!fill && scrollHint ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 flex items-center rounded-r-pill bg-gradient-to-l from-surface-subtle via-surface-subtle/85 to-transparent pl-8 pr-2 sm:hidden"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-ink-muted"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </div>
      ) : null}
    </div>
  );
}
