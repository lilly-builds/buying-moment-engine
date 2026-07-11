import type { SVGProps } from "react";

/**
 * Nav icons (U2 / R15) — the glyphs the mobile bottom tab bar hangs on each
 * destination. Desktop nav is text-only (verified-live: EliseAI's bar is words,
 * not icons); a phone tab bar needs a glyph per tab to stay legible at 11px, so
 * these exist ONLY for the mobile bar.
 *
 * One drawing system so the four read as a set: a 24×24 box, `currentColor`
 * stroke at 1.75, round caps + joins, no fills except the single signal node.
 * They inherit ink from the tab (muted when idle, brand when current), so there
 * is no per-icon color to drift.
 */

type IconProps = SVGProps<SVGSVGElement>;

const BASE: IconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

/** Feed — a stack of prospect cards. */
export function FeedIcon(props: IconProps) {
  return (
    <svg {...BASE} {...props}>
      <rect x="3.5" y="4.5" width="17" height="6" rx="2" />
      <rect x="3.5" y="13.5" width="17" height="6" rx="2" />
    </svg>
  );
}

/** Scoreboard — a bar chart on a baseline. */
export function ScoreboardIcon(props: IconProps) {
  return (
    <svg {...BASE} {...props}>
      <path d="M4 20h16" />
      <path d="M7.5 20v-4.5" />
      <path d="M12 20v-9.5" />
      <path d="M16.5 20v-6.5" />
    </svg>
  );
}

/** Signals — a broadcast radiating from one source node. */
export function SignalsIcon(props: IconProps) {
  return (
    <svg {...BASE} {...props}>
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <path d="M8.6 8.6a4.8 4.8 0 0 0 0 6.8" />
      <path d="M15.4 15.4a4.8 4.8 0 0 0 0-6.8" />
      <path d="M6.1 6.1a8.3 8.3 0 0 0 0 11.8" />
      <path d="M17.9 17.9a8.3 8.3 0 0 0 0-11.8" />
    </svg>
  );
}

/** Integrations — two nodes bound together. */
export function IntegrationsIcon(props: IconProps) {
  return (
    <svg {...BASE} {...props}>
      <circle cx="6.75" cy="12" r="3" />
      <circle cx="17.25" cy="12" r="3" />
      <path d="M9.75 12h4.5" />
    </svg>
  );
}
