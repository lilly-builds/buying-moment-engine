"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card } from "@/design/components";
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
 * THE ANIMATION IS A WHITE-BACKGROUND H.264 MP4 (no transparency). On this WHITE page its
 * background is invisible, so the stack reads as floating — the same look a transparent
 * asset would give, but with none of the VP9-alpha compositing quirks (which showed as a
 * faint ghost/echo of the stack). One opaque asset, universal browser support.
 *
 * LAYERING — an OPAQUE video forces a trade-off with the connector lines. If the video sat
 * above the lines (Lilly's earlier ask), its white frame would paint over any line in the
 * card→disc gap. So the order is:
 *   z-0  the video        — floats on white
 *   z-20 connector lines  — stay visible across the gap, meeting the disc rims (they touch
 *                           the rim rather than tuck under — the cost of an opaque asset)
 *   z-20 cards + title    — never overlap the discs; fade as the ball forms
 * The stack in this asset is BIGGER than the first cut, so the video is wider (64% vs 48%)
 * and the connectors reach further right to meet the enlarged disc rims.
 *
 * Marketing rhythm (big display type, an airy white surface), not the feed's dense gap
 * scale — correct for a hero intro.
 *
 * Robustness the vision needs to survive contact with a browser:
 *   - Autoplay is muted + playsInline (every browser blocks sound-on autoplay); if the
 *     play() promise still rejects, we fall back to a manual "Enter the feed" control
 *     rather than trapping the visitor on a frozen frame.
 *   - prefers-reduced-motion gets the poster + an explicit button, never an auto-advance.
 *   - A "Skip" control is always present — nobody should be held hostage by an intro.
 *   - The feed is prefetched on mount so the hand-off is instant when the ball exits.
 */

/** Whole seconds into the ~4.7s clip where the discs have merged into the ball and begin
 *  to leave — the source cards have said their piece, so the overlay fades here and the
 *  ball's exit is uncluttered. */
const OVERLAY_RELEASE_SECONDS = 3.2;

/** How long the glide-out to the feed runs. Matches `duration-700` on the content below. */
const FADE_MS = 700;

/** Seconds before the clip ends to BEGIN the glide, so the fade overlaps the ball's roll-off
 *  (the transition moves WITH the animation, not after it). */
const GLIDE_LEAD_SECONDS = 0.7;

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
 *  edge (~33%, the narrower cards) to the LEFT RIM of its disc in the enlarged stack (~54%),
 *  at the three card rows and the three disc heights. A faint base line makes the connection,
 *  and a brighter pulse (animate-signal-flow) travels along it from card → store. The lines
 *  stop SHORT of the stack (~49%, a deliberate gap before the disc rims at ~54%) so they
 *  point at the store without touching it. The whole overlay fades as the discs merge.
 *    Job Listings -> top disc · Google Reviews -> middle disc · Acquisition -> bottom disc */
const CONNECTORS = [
  "M 33 27 C 44 27, 47 43, 52 43",
  "M 33 57 C 44 57, 48 58, 52 58",
  "M 33 87 C 44 87, 47 73, 52 73",
];

export function SignalsIntro() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [leaving, setLeaving] = useState(false);
  /** Guards the hand-off so onTimeUpdate + onEnded can't both fire it (double push()). */
  const leavingRef = useRef(false);
  /** True once we've decided the animation can't/shouldn't autoplay — show the manual door. */
  const [manual, setManual] = useState(false);

  // Prefetch the feed so the hand-off when the ball exits is instant, not a cold load.
  useEffect(() => {
    router.prefetch("/");
  }, [router]);

  // Autoplay policy. The <video autoPlay> attribute is the reliable native driver; this
  // effect only OVERRIDES it for the two cases that must not auto-play/auto-advance:
  //   - prefers-reduced-motion (accessibility): hold on the poster, show a real door.
  //   - ?freeze (dev inspection): hold on the poster so the composed scene can be reviewed.
  // Pausing at currentTime 0 also guarantees onEnded/onTimeUpdate never fire, so neither
  // case can auto-advance to the feed.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const freeze =
      typeof window !== "undefined" &&
      window.location.search.includes("freeze");
    if (reduce || freeze) {
      video.pause();
      video.currentTime = 0;
      // Defer out of the synchronous effect body (same shape as the play().catch below):
      // reduced-motion visitors won't auto-advance, so surface the manual "Enter the feed".
      if (reduce) queueMicrotask(() => setManual(true));
      return;
    }
    // Belt-and-suspenders: if the attribute was ignored, start playback; if even that is
    // refused, offer the manual door instead of leaving the visitor on a still frame.
    void video.play().catch(() => setManual(true));
  }, []);

  function toFeed() {
    if (leavingRef.current) return; // fire once — the timeupdate lead and onEnded overlap
    leavingRef.current = true;
    setLeaving(true);
    window.setTimeout(() => router.push("/"), FADE_MS);
  }

  function onTimeUpdate() {
    const video = videoRef.current;
    if (!video) return;
    if (video.currentTime >= OVERLAY_RELEASE_SECONDS) {
      setOverlayVisible(false);
    }
    // Begin the glide a beat BEFORE the clip ends, so the fade rides out on the ball's exit
    // rather than starting after a hard stop. onEnded remains a safety net.
    if (
      Number.isFinite(video.duration) &&
      video.currentTime >= video.duration - GLIDE_LEAD_SECONDS
    ) {
      toFeed();
    }
  }

  return (
    // The SAME health-blue hero gradient the feed paints — so the hand-off has no colour
    // jump. The gradient lives on <main> and does NOT fade; only the CONTENT glides out,
    // leaving continuous blue that the (prefetched) feed then paints over.
    <main
      className="relative min-h-dvh overflow-hidden"
      style={{ backgroundImage: gradients.healthHero }}
    >
      {/* On exit the content glides FORWARD (scale up) as it fades — the sense of moving
          toward the feed — while the blue stays put underneath. */}
      <div
        className={`relative flex min-h-dvh flex-col items-center justify-center gap-10 px-gutter py-12 transition-[opacity,transform] duration-700 ease-out lg:block lg:p-0 ${
          leaving ? "scale-[1.06] opacity-0" : "scale-100 opacity-100"
        }`}
      >
        {/* Connectors, desktop only. ABOVE the video (z-20): the animation is an OPAQUE
            white-background MP4 on a white page, so its frame would paint over any line in
            the card→disc gap if the line sat beneath it. Above it, the lines stay visible
            across the gap and meet the disc rims. preserveAspectRatio=none lets the viewBox
            track the canvas so the ends stay anchored to the card rows as the viewport flexes.
            Fades with the cards. */}
        <svg
          className={`absolute inset-0 z-20 hidden h-full w-full transition-opacity duration-700 lg:block ${
            overlayVisible ? "opacity-100" : "opacity-0"
          }`}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {CONNECTORS.map((d, i) => (
            <g key={d}>
              {/* Faint base line — always makes the card→disc connection. */}
              <path
                d={d}
                fill="none"
                stroke="currentColor"
                // non-scaling-stroke reads strokeWidth in SCREEN px, so this is a crisp
                // ~1px line rather than a hairline resolved in user-units.
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
                className="text-ink/25"
              />
              {/* Brighter pulse that travels the line from card → store. pathLength=100
                  normalises the dash math so the pulse crosses the whole line regardless of
                  the stretched viewBox; the per-line delay makes them fire in sequence. */}
              <path
                d={d}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                pathLength={100}
                strokeDasharray="16 84"
                className="animate-signal-flow text-ink"
                style={{ animationDelay: `${0.5 + i * 0.35}s` }}
              />
            </g>
          ))}
        </svg>

        {/* The animation: the data store. A TRANSPARENT VP9-alpha WebM, so the discs float
            directly on the blue hero (a white-background video would show as a white box on
            the gradient). Transparent PNG poster for the pre-play / reduced-motion still.
            Sits below the connectors (z-0). */}
        <video
          ref={videoRef}
          className="pointer-events-none z-0 order-3 w-full max-w-[620px] lg:absolute lg:right-[1%] lg:top-[57%] lg:order-none lg:w-[64%] lg:max-w-none lg:-translate-y-1/2"
          src="/media/buying-moment-signals.webm"
          poster="/media/buying-moment-signals-poster.png"
          muted
          playsInline
          autoPlay
          onEnded={toFeed}
          onTimeUpdate={onTimeUpdate}
          aria-hidden="true"
        />

        {/* LAYER 2 — title (top-left, page header) + source cards. Above the video (z-20).
            Fade out as the ball forms. */}
        <div
          className={`contents transition-opacity duration-700 lg:pointer-events-none lg:absolute lg:inset-0 lg:z-20 lg:block ${
            overlayVisible ? "opacity-100" : "opacity-0"
          }`}
        >
          {/* The title — top-left, aligned to the cards' left edge (13%), white on the blue
              hero. Sized down and kept on ONE line (desktop) across the top, above the cards
              and the stack. Mobile wraps normally. */}
          <h1 className="order-1 text-center font-display text-h3 text-white lg:absolute lg:left-[13%] lg:top-[6%] lg:whitespace-nowrap lg:text-left">
            Finding prospects based on key buying moment signals
          </h1>

          {/* Cards: the kit's Card variant="glass" — translucent white + blur, so the blue
              hero shows through and they read as the same material as the glassy discs
              (lighter on the blue than a solid white fill). Narrow left column, spread
              top→bottom, sitting LOWER than the header for breathing room. Staggered glide-in. */}
          <div className="order-2 flex w-full max-w-[360px] flex-col gap-6 lg:absolute lg:left-[13%] lg:top-[22%] lg:bottom-[8%] lg:order-none lg:w-[20%] lg:max-w-none lg:justify-between lg:gap-0">
            {SOURCES.map(({ signal, source }, i) => (
              <Card
                key={signal}
                variant="glass"
                padding="md"
                className="animate-card-glide-in text-center"
                style={{ animationDelay: `${i * 0.22}s` }}
              >
                <p className="font-display text-h4 text-ink">{signal}</p>
                <p className="mt-1 font-sans text-base font-medium text-ink-muted">
                  {source}
                </p>
              </Card>
            ))}
          </div>
        </div>
      </div>

      {/* Skip is always available and always interactive (the overlay is pointer-events-none
          on desktop so the video never eats the click). */}
      <div className="absolute right-6 top-6 z-30">
        <Button variant="secondary" size="sm" onClick={toFeed}>
          {manual ? "Enter the feed" : "Skip"}
        </Button>
      </div>
    </main>
  );
}
