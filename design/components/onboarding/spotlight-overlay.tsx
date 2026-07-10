import { SPOTLIGHT_PAD, type Rect } from "@/src/onboarding/spotlight";

/**
 * SpotlightOverlay — the dim backdrop with a cut-out over the spotlit element.
 *
 * The whole page dims (a big `box-shadow` spread paints everything except the
 * hole), and a brand-coloured ring outlines the target. `pointer-events: none`
 * keeps it fully NON-BLOCKING — the real UI underneath stays clickable, so the
 * learner can actually connect HubSpot / open the brief through the spotlight.
 * A `null` rect means "no target on screen yet" → a plain full-screen dim.
 *
 * Extracted verbatim from the AE tour so both coach-throughs dim identically.
 */
export function SpotlightOverlay({ rect }: { rect: Rect | null }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-[60]" aria-hidden="true">
      {rect ? (
        <div
          className="absolute rounded-panel transition-all duration-300 ease-out"
          style={{
            top: rect.top - SPOTLIGHT_PAD,
            left: rect.left - SPOTLIGHT_PAD,
            width: rect.width + SPOTLIGHT_PAD * 2,
            height: rect.height + SPOTLIGHT_PAD * 2,
            boxShadow:
              "0 0 0 9999px color-mix(in srgb, var(--color-surface-dark) 62%, transparent), 0 0 0 2px var(--color-brand)",
          }}
        />
      ) : (
        <div
          className="absolute inset-0"
          style={{ background: "color-mix(in srgb, var(--color-surface-dark) 55%, transparent)" }}
        />
      )}
    </div>
  );
}
