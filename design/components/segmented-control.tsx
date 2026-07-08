"use client";

import { useRef } from "react";
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
  label,
  className,
}: SegmentedControlProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

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
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        // `w-fit`: `inline-flex` sets the inner layout, not the outer size — inside a
        // flex column the default `align-self: stretch` blows the track out to the
        // full column width and leaves a dead grey gutter on the right.
        "inline-flex w-fit items-center gap-1 rounded-pill bg-surface-subtle p-1",
        className,
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
              "rounded-pill font-sans font-book tracking-control whitespace-nowrap transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
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
  );
}
