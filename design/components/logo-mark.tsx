import { cn } from "@/design/lib/cn";

/**
 * LogoMark (Adapt-It P5) — the small brand mark that sits beside the wordmark.
 *
 * The product is "reach every buyer at their buying moment," so the glyph reads as a
 * signal firing at a moment: a point with two arcs radiating from it, like a ping the
 * instant a buying signal lands. It sits on a rounded tile painted with the brand
 * `gradient-orb`, so the mark re-skins per tenant through the exact same
 * `--gradient-orb` variable the onboarding orb uses — one lever, every tenant. The
 * glyph itself is `currentColor` (white on the tile), so it stays crisp on any nav
 * tone while the tile carries the colour.
 *
 * `shadow-ring` gives the tile a hair of material so it reads as a mark, not a
 * flat swatch. Decorative: `aria-hidden`, since the adjacent wordmark names the brand.
 */

export interface LogoMarkProps {
  /** Tile edge in px. Default pairs with the nav wordmark (text-xl). */
  size?: number;
  className?: string;
}

export function LogoMark({ size = 28, className }: LogoMarkProps) {
  const glyph = Math.round(size * 0.64);
  return (
    <span
      aria-hidden
      className={cn(
        "gradient-orb inline-flex shrink-0 items-center justify-center rounded-panel text-white shadow-ring",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <svg
        width={glyph}
        height={glyph}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* The moment: a point where the signal lands. */}
        <circle cx="8" cy="16" r="2.1" fill="currentColor" stroke="none" />
        {/* Two arcs radiating from it — the signal firing. */}
        <path d="M8 10.4a5.6 5.6 0 0 1 5.6 5.6" />
        <path d="M8 5.6a10.4 10.4 0 0 1 10.4 10.4" />
      </svg>
    </span>
  );
}
