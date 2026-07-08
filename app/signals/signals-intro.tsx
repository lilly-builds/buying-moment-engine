"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/design/components";
import { gradients } from "@/design/tokens";

/**
 * "Buying Moment Signals" — the intro (page #3 of the three, the Data Sources display).
 *
 * A client island because it choreographs: the disc-stack animation plays, the discs
 * merge into a ball, the ball rolls off-screen, and the whole page cross-fades into the
 * prospect feed. That is Lilly's vision — "start here briefly, then transition to the feed
 * when the ball goes off screen." The video IS the data-store graphic from her Canva
 * mockup; the source cards and connectors sit over it exactly where the mockup places them.
 *
 * The composition is a designed hero canvas, not a feed screen, so it uses the marketing
 * rhythm (big display type, a gradient surface) rather than the dense gap scale — this is
 * the one place py-section-style generosity is correct.
 *
 * Robustness the vision needs to survive contact with a browser:
 *   - Autoplay is muted + playsInline (every browser blocks sound-on autoplay); if the
 *     play() promise still rejects, we fall back to a manual "Enter the feed" control
 *     rather than trapping the visitor on a frozen frame.
 *   - prefers-reduced-motion gets the poster + an explicit button, never an auto-advance.
 *   - A "Skip" control is always present — nobody should be held hostage by an intro.
 *   - The feed is prefetched on mount so the hand-off is instant when the ball exits.
 */

/** Whole seconds into the 5.09s clip where the discs have merged into the ball and begin
 *  to leave — the source cards have said their piece, so the overlay fades here and the
 *  ball's exit is uncluttered. Measured from the extracted frames, not guessed. */
const OVERLAY_RELEASE_SECONDS = 3.2;

/** How long the whole-page cross-fade to the feed runs. Matches `duration-500` below. */
const FADE_MS = 500;

/**
 * The three built signal sources (D3). Labels are source-facing, as Lilly's mockup wants.
 *
 * Sources are the ACCURATE provider names, corrected from the Canva placeholders ("Azuna"
 * on two cards): the staffing detector reads Adzuna, phone-complaints reads Google
 * Places/Maps, growth-events reads GDELT. A Data Sources page that names the wrong source
 * would undercut the very provenance (D2) it exists to show.
 */
const SOURCES: ReadonlyArray<{ signal: string; source: string }> = [
  { signal: "Job Listings", source: "Adzuna" },
  { signal: "Google Reviews", source: "Google Maps" },
  { signal: "Acquisition News", source: "GDELT" },
];

export function SignalsIntro() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [leaving, setLeaving] = useState(false);
  /** True once we've decided the animation can't/shouldn't autoplay — show the manual door. */
  const [manual, setManual] = useState(false);

  // Prefetch the feed so the hand-off when the ball exits is instant, not a cold load.
  useEffect(() => {
    router.prefetch("/");
  }, [router]);

  // Reduced motion: never autoplay, never auto-advance. Show the poster and a real door.
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setManual(true);
      return;
    }
    // Autoplay can still be refused; if the promise rejects, offer the manual control
    // instead of leaving the visitor on a still frame.
    const video = videoRef.current;
    if (!video) return;
    video.play().catch(() => setManual(true));
  }, []);

  function toFeed() {
    setLeaving(true);
    window.setTimeout(() => router.push("/"), FADE_MS);
  }

  function onTimeUpdate() {
    const video = videoRef.current;
    if (video && video.currentTime >= OVERLAY_RELEASE_SECONDS) {
      setOverlayVisible(false);
    }
  }

  return (
    <main className="relative min-h-dvh overflow-hidden bg-surface-subtle">
      {/* The whole canvas fades on exit; the feed is already prefetched underneath. */}
      <div
        className={`transition-opacity duration-500 ${leaving ? "opacity-0" : "opacity-100"}`}
      >
        {/* --- The animation: the data store. Lilly's graphic, now moving. --- */}
        <video
          ref={videoRef}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          src="/media/buying-moment-signals.mp4"
          poster="/media/buying-moment-signals-poster.jpg"
          muted
          playsInline
          autoPlay
          onEnded={toFeed}
          onTimeUpdate={onTimeUpdate}
          aria-hidden="true"
        />

        {/* --- The source cards + connectors, over the stack. Fade out as the ball forms. --- */}
        <div
          className={`pointer-events-none absolute inset-0 transition-opacity duration-700 ${
            overlayVisible ? "opacity-100" : "opacity-0"
          }`}
        >
          {/* Connectors, desktop only: three curved lines from each card to the stack, as
              in the mockup. preserveAspectRatio=none lets the viewBox track the canvas so
              the ends stay anchored to the card rows as the viewport flexes. */}
          <svg
            className="absolute inset-0 hidden h-full w-full lg:block"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {[
              "M 30 20 C 42 20, 40 45, 52 45",
              "M 30 50 C 44 50, 46 50, 55 50",
              "M 30 80 C 42 80, 44 58, 53 58",
            ].map((d) => (
              <path
                key={d}
                d={d}
                fill="none"
                stroke="currentColor"
                strokeWidth="0.25"
                vectorEffect="non-scaling-stroke"
                className="text-ink-faint"
              />
            ))}
          </svg>

          {/* Cards. On desktop they sit at the three connector heights; on narrow screens
              they fall into a simple centered column above the fold. */}
          <div className="flex flex-col gap-6 px-gutter pt-16 lg:absolute lg:left-[6%] lg:top-0 lg:h-full lg:w-[30%] lg:justify-center lg:px-0 lg:pt-0">
            {SOURCES.map(({ signal, source }) => (
              <div
                key={signal}
                className="rounded-card px-8 py-6 text-center shadow-soft"
                style={{ backgroundImage: gradients.brandSoft }}
              >
                <p className="font-display text-h5 text-ink">{signal}</p>
                <p className="mt-1 font-sans text-sm font-medium text-ink-strong">
                  {source}
                </p>
              </div>
            ))}
          </div>

          {/* The title — bottom-right, big Inter Tight, exactly as the mockup lands it. */}
          <h1 className="px-gutter pb-10 pt-8 text-center font-display text-h2 text-ink lg:absolute lg:right-[5%] lg:bottom-[7%] lg:px-0 lg:text-right">
            Buying Moment Signals
          </h1>
        </div>
      </div>

      {/* Skip is always available and always interactive (the overlay above is
          pointer-events-none so the video never eats the click). */}
      <div className="absolute right-6 top-6 z-10">
        <Button variant="secondary" size="sm" onClick={toFeed}>
          {manual ? "Enter the feed" : "Skip"}
        </Button>
      </div>
    </main>
  );
}
