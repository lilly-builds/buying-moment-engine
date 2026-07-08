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
 * LAYOUT (matches the mockup's proportions, not a full-bleed video):
 *   - The video is a CONTAINED element on the right — natural 16:9, never object-cover —
 *     vertically centred, its right edge near the viewport edge so the ball still rolls
 *     off the real screen. Its background is #f6f6f6, within rounding of the page's
 *     `surface-subtle` (#f5f5f7), so the stack reads as floating with no visible box.
 *   - The three source cards sit on the left at the mockup's vertical rhythm, narrower
 *     than the gap between them and the stack — long connectors bridge that gap.
 *   - The title lands bottom-right.
 * Marketing rhythm (big display type, an airy surface), not the feed's dense gap scale —
 * correct for a hero intro.
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

/** Connector curves, in the 0–100 viewBox that `preserveAspectRatio="none"` stretches to
 *  fill the canvas (so coords read as viewport percentages). Each runs from a card's right
 *  edge (~33%) to the LEFT RIM of its disc in the stack (~67%), at the three card rows and
 *  the three disc heights measured off the rendered frame — so the line lands ON the
 *  graphic, not in the gap before it. Tuned for the desktop hero; they fade as the discs
 *  merge, so they never dangle once the stack becomes the ball.
 *    Job Listings   -> top disc     · Google Reviews -> middle disc · Acquisition -> bottom */
const CONNECTORS = [
  "M 33 20 C 50 20, 53 42, 67 42",
  "M 33 50 C 52 50, 55 53, 67 53",
  "M 33 80 C 50 80, 53 64, 67 64",
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
        className={`relative flex min-h-dvh flex-col items-center justify-center gap-10 px-gutter py-12 transition-opacity duration-500 lg:block lg:p-0 ${
          leaving ? "opacity-0" : "opacity-100"
        }`}
      >
        {/* --- The animation: the data store. Contained on the right, natural 16:9. --- */}
        <video
          ref={videoRef}
          className="pointer-events-none order-2 w-full max-w-[560px] lg:absolute lg:right-[2%] lg:top-1/2 lg:order-none lg:w-[48%] lg:max-w-none lg:-translate-y-1/2"
          // Feather the frame edges to nothing so the stack FLOATS on the page instead of
          // sitting in a visible #f6f6f6 rectangle. The discs live in the middle ~60%, so
          // an ellipse opaque to 58% and clear by 88% keeps them sharp and dissolves the
          // background box (and the ball as it rolls out — reads as leaving the screen).
          style={{
            WebkitMaskImage:
              "radial-gradient(ellipse 62% 72% at 50% 50%, #000 58%, transparent 88%)",
            maskImage:
              "radial-gradient(ellipse 62% 72% at 50% 50%, #000 58%, transparent 88%)",
          }}
          src="/media/buying-moment-signals.mp4"
          poster="/media/buying-moment-signals-poster.jpg"
          muted
          playsInline
          autoPlay
          onEnded={toFeed}
          onTimeUpdate={onTimeUpdate}
          aria-hidden="true"
        />

        {/* --- Source cards + connectors, over the stack. Fade out as the ball forms. --- */}
        <div
          className={`contents transition-opacity duration-700 lg:pointer-events-none lg:absolute lg:inset-0 lg:block ${
            overlayVisible ? "opacity-100" : "opacity-0"
          }`}
        >
          {/* Connectors, desktop only. preserveAspectRatio=none lets the viewBox track the
              canvas so the ends stay anchored to the card rows as the viewport flexes. */}
          <svg
            className="absolute inset-0 hidden h-full w-full lg:block"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {CONNECTORS.map((d) => (
              <path
                key={d}
                d={d}
                fill="none"
                stroke="currentColor"
                // non-scaling-stroke reads strokeWidth in SCREEN px, so this is a crisp
                // ~1.1px line rather than the hairline 0.2 user-units resolved to before.
                strokeWidth="1.1"
                vectorEffect="non-scaling-stroke"
                className="text-ink-body"
              />
            ))}
          </svg>

          {/* Cards: narrow, left, at the mockup's vertical rhythm (justify-between spreads
              them to the top/middle/bottom of a generously inset column). */}
          <div className="order-1 flex w-full max-w-[440px] flex-col gap-6 lg:absolute lg:left-[8%] lg:top-[15%] lg:bottom-[15%] lg:order-none lg:w-[25%] lg:max-w-none lg:justify-between lg:gap-0">
            {SOURCES.map(({ signal, source }) => (
              <div
                key={signal}
                className="rounded-card px-6 py-5 text-center shadow-soft"
                style={{ backgroundImage: gradients.brandSoft }}
              >
                <p className="font-display text-h5 text-ink">{signal}</p>
                <p className="mt-1 font-sans text-sm font-medium text-ink-strong">
                  {source}
                </p>
              </div>
            ))}
          </div>

          {/* The title — bottom-right, big Inter Tight, as the mockup lands it. */}
          <h1 className="order-3 text-center font-display text-h1 text-ink lg:absolute lg:right-[4%] lg:bottom-[6%] lg:text-right">
            Buying Moment Signals
          </h1>
        </div>
      </div>

      {/* Skip is always available and always interactive (the overlay is pointer-events-none
          on desktop so the video never eats the click). */}
      <div className="absolute right-6 top-6 z-10">
        <Button variant="secondary" size="sm" onClick={toFeed}>
          {manual ? "Enter the feed" : "Skip"}
        </Button>
      </div>
    </main>
  );
}
