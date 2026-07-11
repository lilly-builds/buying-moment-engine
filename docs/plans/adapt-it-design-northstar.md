# Adapt-It — design north star (read before building)

Every build subagent follows this. The existing design system is **excellent** (see
`design/tokens.ts`, `design/rules.ts`, `/styleguide`). BUILD ON IT. Reuse the component kit in
`design/components/*`. Do not introduce a second styling pipeline or generic Tailwind defaults.

## Product framing
- SaaS shell product name (pre-signup): **"Moment"** — "reach every buyer at their buying moment."
- The setup experience is **Adapt-It**, run by an AI agent we call **the Adapter**.
- After onboarding, the tenant's own product name (they choose one, AI suggests one) replaces
  "Moment" everywhere via the active workspace. The default (no workspace) stays EliseAI / "GTM Maestro".

## The five laws (Don't Make Me Think + Jobs)
1. **One decision per screen.** Never show two primary actions. The next step is always obvious.
2. **The AI does the work; the human confirms.** Default answers are pre-filled by Claude. Typing
   is the exception, not the rule. A confirm tap should always be enough to move forward.
3. **Show, don't tell.** The moment they finish, the app visibly *transforms* to their brand. The
   adaptation is a felt event, not a toast notification.
4. **Ruthless detail.** Type rhythm, optical spacing, one considered motion per screen, real
   empty/loading states, materiality on surfaces. No templated rectangles. If it looks like a
   Tailwind starter, it is wrong.
5. **Plain, warm, 8th-grade voice. Zero em dashes anywhere.** Bottom line first. No jargon.

## Onboarding choreography (the showpiece)
A short, gorgeous, one-thing-per-screen flow. ~5 beats, mostly AI-proposes / user-confirms:
1. **Who you are** — company name + what you sell (one line, or a website URL). Warm opener from
   the Adapter.
2. **Who you sell to** — the Adapter proposes an ICP; user nods or nudges.
3. **The buying moment** — the heart. The Adapter proposes 3 buying-moment signals *for their
   business* (with the "why it predicts a buy" reasoning). User keeps/edits. This is the thesis.
4. **Your proof** — one result/metric or case study; the Adapter formats it into a proof point.
5. **Make it yours** — pick a brand color (or pull from their site), confirm the product name the
   Adapter suggests. Live preview of the theme.
Then: **"Adapting your engine…"** a brief, confident reveal, and the branded dashboard slides in,
already populated with 3 sample prospect briefs written in their voice.

Feel: calm, high-craft, a little magical. Progress you can feel (not a clunky stepper). Motion is
restrained and purposeful. Reduced-motion respected.

## Theming mechanism (do not break parity tests)
- Never edit `design/tokens.ts` or `app/globals.css` `@theme` to re-skin (a parity test locks them).
- Re-skin via a **runtime CSS-variable override layer** keyed to the active workspace.
- Migrate the 4 JS-hex gradients (`healthHero`, `orb`, `brand`, `signalGradients`) and `StatRing`'s
  JS-hex stroke to CSS variables so ONE override reaches 100% of the surface.

## Non-negotiables
- Additive + reversible. The EliseAI default path and its tests stay green.
- No hidden errors: no `any`, no `@ts-ignore`, no disabled lint/types, no weakened tests.
- Typecheck (`npx tsc --noEmit`) must pass. Do NOT run `next build` (heavy; disk is tight) — the
  orchestrator runs the dev server + browser test at the end.
- Business data only. Nothing sends. No fabricated "done."
