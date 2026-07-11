import { NAV_BAR_HEIGHT, SPOTLIGHT_PAD, type Rect } from "@/src/onboarding/spotlight";

/**
 * SpotlightOverlay — the dim backdrop with a cut-out over the spotlit element.
 *
 * Two layers on purpose:
 *   1. the DIM (z-[60]) — a big `box-shadow` spread paints everything except the
 *      hole. It sits BELOW the top nav (z-[65]) so the nav never gets glossed over,
 *      which matters when a step points AT a nav link.
 *   2. the RING (z-[68]) — the brand outline around the target, ABOVE the nav so a
 *      spotlit nav link is still clearly ringed (a ring baked into the dim would
 *      hide behind the lit nav).
 *
 * `pointer-events: none` on both keeps it fully NON-BLOCKING — the real UI
 * underneath stays clickable. A `null` rect means "no target on screen yet" → a
 * plain full-screen dim (and no ring).
 */
export function SpotlightOverlay({ rect }: { rect: Rect | null }) {
  const frame = rect
    ? {
        top: rect.top - SPOTLIGHT_PAD,
        left: rect.left - SPOTLIGHT_PAD,
        width: rect.width + SPOTLIGHT_PAD * 2,
        height: rect.height + SPOTLIGHT_PAD * 2,
      }
    : null;

  return (
    <>
      {/* 1 · the dim — clipped to START below the nav, so the nav is never
             overlaid at all (its transparent, blurred bar would otherwise let the
             dim bleed through and wash out the links). */}
      <div
        className="pointer-events-none fixed inset-0 z-[60]"
        aria-hidden="true"
        style={{ clipPath: `inset(${NAV_BAR_HEIGHT}px 0 0 0)` }}
      >
        {frame ? (
          <div
            className="absolute rounded-panel transition-all duration-300 ease-out"
            style={{
              ...frame,
              boxShadow:
                "0 0 0 9999px color-mix(in srgb, var(--color-surface-dark) 62%, transparent)",
            }}
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{ background: "color-mix(in srgb, var(--color-surface-dark) 55%, transparent)" }}
          />
        )}
      </div>

      {/* 2 · the ring — above the nav so a spotlit nav link is still outlined */}
      {frame ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[68] rounded-panel transition-all duration-300 ease-out"
          style={{ ...frame, boxShadow: "0 0 0 2px var(--color-brand)" }}
        />
      ) : null}
    </>
  );
}
