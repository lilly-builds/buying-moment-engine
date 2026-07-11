# Adapt-It: where this stands

Plain-language status for the "productize the buying-moment engine" experiment. For the deep
technical log see `docs/adapt-it-build-log.md`. For the product framing see `PRODUCT.md`.

## The goal (why this exists)

I built an internal buying-moment sales tool (hard-wired to one customer, EliseAI, in healthcare).
This experiment turns it into a self-serve product any B2B company can use. The heart of the product
is an easeful onboarding: an AI interviews a business for about two minutes, then rebuilds the whole
app around them, their buying-moment signals, their pitch, their proof, and their brand. They walk
away with a live feed of prospects and briefs written in their own voice. Setup should feel effortless,
even a little magical, and never like configuring a tool.

## Where it lives

- Branch `adapt-it` on GitHub (never merged to main). This is an experiment branch.
- Run it locally: `cd ~/Developer/bme-adapt-it && npx next dev --webpack`, then open
  `http://localhost:3000/welcome`. (Use the `--webpack` flag; the default bundler crashes on this
  worktree's shared node_modules.)

## What is built and working

1. The adaptation engine. Any business becomes a self-contained workspace holding its brand, signals,
   pitch, proof, and a sample feed. One runtime change repaints the whole app in the tenant's brand.
   The original EliseAI setup is untouched and still works.
2. Two onboarding versions (this is the part we were shaping today):
   - Version 1, the stepped form, at `/adapt`. Five calm screens, one decision each. Done and verified.
   - Version 2, the conversational Adapter, at `/adapt/chat`. A split view: you talk on the left, and
     the real app assembles itself on the right, in grayscale, then floods to your brand color the
     moment the Adapter names it. Warm, human voice with no AI-tell language. Built and verified end
     to end (a freight-company test run reached the finished dashboard with zero errors).
3. The adapted dashboard, a customization studio (every AI-set lever is hand-editable), an honest
   scoreboard, and a marketing landing at `/welcome`.
4. Security: a background review flagged the tenant cookie as forgeable; that is fixed (the cookie is
   now signed), so one business can never reach another's data or the original real contact data.

## Open issues to pick up next time

- The `/adapt/chat` composer is still cut off at the bottom on some window sizes. I attempted a layout
  fix today and it did NOT resolve it. This is the first thing to fix when we return. Likely the
  fixed-height (100dvh) model versus the actual browser window height; needs a real in-browser look
  (the browser screenshot tool was erroring during this session, which slowed diagnosis).
- The two onboarding versions have no in-product way to choose between them yet beyond small text
  links. Decide whether the chat version becomes the default and the form the fallback.

## Roadmap (deliberately not built yet, all honest)

- Real sign-up accounts and database-level tenant isolation (today it is config-level, hardened by the
  signed cookie; production wants per-row isolation).
- Live signal detection for any industry (the sample feed is AI-written for now; the detector seams are
  ready to wire real data into).
- A rate limit on the public onboarding before any real deploy (it spends AI credits).

## Design context captured today

- `PRODUCT.md` (register, users, positioning, the warm-sharp-spare voice, anti-references).
- The Adapter's copy follows an anti-AI-writing ruleset (no "let's dive in", no "seamless", no em
  dashes, short human turns).
