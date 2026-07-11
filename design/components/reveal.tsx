"use client";

import {
  useEffect,
  useRef,
  useState,
  type ElementType,
  type ReactNode,
} from "react";
import { cn } from "@/design/lib/cn";

/**
 * Reveal (Adapt-It P5) — a restrained scroll-into-view entrance.
 *
 * Wraps a block and fades + lifts it the first time it reaches the viewport, using an
 * IntersectionObserver (no scroll listener, no library). It reveals ONCE and then
 * disconnects, so a section never re-animates as the reader scrolls back past it.
 *
 * Correctness first: content must NEVER be left permanently invisible. A naive
 * observer leaves a block stuck transparent whenever it is jumped past rather than
 * scrolled through — scroll restoration on a back-nav, an in-page anchor, or a fast
 * fling. So the reveal fires on any of four conditions: reduced-motion or no observer
 * support (show at once), the block is already at or above the fold at mount, the
 * observer reports it intersecting or already scrolled past, or a safety timeout
 * elapses. The transition is the polish; visibility is guaranteed.
 *
 * Used on the marketing landing's below-the-fold sections. Keep the hero and any
 * critical above-the-fold copy OUT of a Reveal — its start state is transparent, so
 * it should only wrap content the reader scrolls down to meet.
 */

export interface RevealProps {
  children: ReactNode;
  /** Stagger a group by passing an increasing delay per item. */
  delayMs?: number;
  as?: ElementType;
  className?: string;
}

/** Absolute guarantee that nothing stays hidden, even if every scroll heuristic misses. */
const SAFETY_MS = 2500;

export function Reveal({
  children,
  delayMs = 0,
  as: Tag = "div",
  className,
}: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }

    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // Intersecting (scrolled into view) OR already scrolled past (top < 0).
          if (entry.isIntersecting || entry.boundingClientRect.top < 0) {
            reveal();
            return;
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -10% 0px" },
    );

    function reveal() {
      if (done) return;
      done = true;
      io.disconnect();
      if (timer) clearTimeout(timer);
      setShown(true);
    }

    io.observe(el);
    // Already at or above the fold at mount (initial viewport or a restored scroll
    // position) — show now rather than wait for a scroll that already happened.
    if (el.getBoundingClientRect().top < window.innerHeight) reveal();
    // Last-resort guarantee against any missed scroll heuristic.
    timer = setTimeout(reveal, SAFETY_MS);

    return () => {
      io.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <Tag
      ref={ref}
      style={{ transitionDelay: shown ? `${delayMs}ms` : "0ms" }}
      className={cn(
        "transition-all duration-700 ease-out will-change-[opacity,transform]",
        "motion-reduce:transition-none motion-reduce:transform-none",
        shown ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
