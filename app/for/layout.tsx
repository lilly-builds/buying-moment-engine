import type { ReactNode } from "react";

/**
 * Layout for the landing experiments (/for/*). Its only job beyond passing
 * children through is to inject a small, landing-scoped stylesheet: field focus
 * states and text selection, both keyed off the ambient --accent set by each
 * page's theme root. Keeping this here means the product's globals.css is never
 * touched by the marketing pages.
 *
 * This layout nests under the app root layout (which loads the fonts). The root
 * layout's onboarding tour is inert here: it only activates on product routes.
 */
const scoped = `
  .bm-field {
    background: var(--ground);
    border: 1px solid var(--line);
    color: var(--ink);
    transition: border-color .15s ease, box-shadow .15s ease;
  }
  .bm-field::placeholder { color: var(--ink-muted); opacity: .7; }
  .bm-field:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
  }
  .bm-scope ::selection { background: color-mix(in srgb, var(--accent) 22%, transparent); }
  .bm-scope { scroll-behavior: smooth; }
  @media (prefers-reduced-motion: reduce) { .bm-scope { scroll-behavior: auto; } }
`;

export default function ForLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bm-scope">
      {/* Static, first-party CSS string (no user input) — safe as a style child. */}
      <style>{scoped}</style>
      {children}
    </div>
  );
}
