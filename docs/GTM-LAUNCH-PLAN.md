# Buying Moment — GTM Launch Plan (executable)

**Goal:** get the marketing channel set up *well* and launch. One buyer, one magnet,
one clean funnel that actually delivers value, then traffic.

**How to use this doc:** it is written to be dropped into Claude Code. Each phase
has concrete tasks with a copy-paste prompt and an acceptance test. Do the phases
in order. Phase A is the make-or-break; everything after it is lighter.

Last updated 2026-07-11. Branch with all the work: `marketing-landing-experiments`
(pushed to GitHub, not merged to main, not deployed to production).

---

## 1. The decisions that are locked (do not relitigate)

- **What it is:** you tell it what you sell, it finds companies at a buying moment
  for it and hands you the company, the person, the cited why-now, and the first
  email, already written.
- **The buyer / niche:** **B2B software revenue teams.** Clear and easy to explain,
  and they have budget. Rejected "anyone who sells B2B" as too vague to sell.
- **The channel model:** **the free tool IS the channel.** Not a teaser that points
  at the product, a live proof *of* the product. SEO pages help people find it; the
  tool does the converting; a result that good gets shared.
- **The magnet (Hormozi-grade):** say what you sell -> see ONE real, researched
  example lead instantly, no signup, showing the 3 public signals that stack into
  "in-market" -> low-friction email -> **5 real researched leads delivered free,
  for your exact thing** (this is the reverse trial). Give a real result, reveal the
  next problem (doing this every day), which the paid product solves.
- **Killed:** champagne outbound (the "I found you the way our product works" email).
  It feels weird to receive and leans on fragile cold sending.
- **Pricing shape (tune later):** flat tiers with an included bundle of "briefs,"
  reverse trial up front. Illustrative: Starter $199, Growth $499, Team $999/mo for
  the software-seller buyer (undercuts UserGems ~$2,750 and Common Room ~$2,100).

**Still yours to decide (see section 6):** brand name + USPTO, final pricing,
whether to keep all three landing variants or focus on the software niche, and
which email service to send from.

---

## 2. What is already built (do not rebuild)

On branch `marketing-landing-experiments`:

- **The free tool (the magnet):** `app/tools/buying-moment-check/` — the full funnel
  above, dark "intelligence console" world, email capture wired to `/api/waitlist`
  and verified end-to-end. This is the centerpiece.
- **The living visual world:** `components/marketing/signal-field.tsx` — a generative
  canvas of companies where buying moments ignite. Themed, reduced-motion safe.
- **Three A/B landing pages:** `app/for/[niche]/` (`/for/saas`, `/for/outbound`,
  `/for/founders`), each testing a different positioning. Signal field is in the
  heroes; full world-building across them is only started.
- **Programmatic SEO:** `app/moments/` and `app/moments/[industry]/` — field guides
  that funnel to the tool. Add industries in `app/moments/industries.ts`.
- **Capture + measurement:** tables `waitlist_signups` + `marketing_events`,
  public routes `/api/waitlist` and `/api/track`, and the readout
  `npx tsx scripts/lp-report.ts` (conversion by page and by source).
- **The engine itself** (the product): reads public signals -> cited brief + email.
  This is what must fulfill the magnet's promise (Phase A).

Nothing is deployed to production; `buying-moment-maestro.vercel.app` still serves
only the existing product.

---

## 3. The critical path to launch

### PHASE A — Make the magnet actually deliver (the "set up WELL" core)

The tool promises "5 real researched leads for what you sell, free, within a day."
Right now that is a promise with no fulfillment behind it. **This is the one thing
that has to be real for the channel to be good.** Everything else is decoration on
top of this.

- **A1. Scope the engine against an arbitrary "what you sell."** The engine today is
  shaped around a healthcare ICP. Map exactly what happens if you feed it
  "a modern TMS platform for freight teams": what works, what is hard-coded, what is
  missing to turn a free-text offer into a real ICP + 5 briefed companies.
  - _Drop-in:_ "Read the engine in src/ (discovery, detectors, brief, enrich). Tell
    me precisely what it would take to go from a free-text 'what you sell' string to
    5 real cited buying-moment briefs for that offer. List the gaps and the smallest
    build that closes them."
  - _Done when:_ you have a written gap list and a chosen approach.

- **A2. Build the fulfillment job.** On a tool signup, enqueue a job that derives the
  ICP from `what_you_sell`, finds ~5 companies at a buying moment, researches and
  briefs each, and stores them against the signup. Reuse the existing pipeline; do
  not invent a new one.
  - _Done when:_ a real signup produces 5 real cited briefs in the DB.

- **A3. Deliver the package by email.** Send the 5 briefs to the signup's inbox in a
  designed email (mirror the on-page dossier look). Pick a transactional sender
  (Resend or Postmark are simplest) and wire it.
  - _Done when:_ you receive a real 5-brief email to a test address.

- **A4. Put guardrails on the public tool.** Add a per-signup cost cap and IP rate
  limiting to `/api/waitlist` and `/api/track` (Vercel KV or Upstash) so a public,
  unauthenticated magnet cannot run up cost or pollute the numbers. Honeypot +
  email dedup are already in place; this adds the ceiling.
  - _Done when:_ hammering the endpoint is bounded and logged.

- **A5. QA the whole magnet on a real run.** One real "what you sell" -> instant
  example -> signup -> 5 real leads arrive -> they are genuinely good. Fix the
  weakest link (usually lead quality).
  - _Done when:_ you would be happy to receive this cold.

### PHASE B — Ship it live

- **B1. Decide the production surface.** The marketing routes (`/for/*`, `/tools/*`,
  `/moments/*`) are public by design and already exempt from the auth gate. Confirm
  the product app stays gated. (See `src/lib/auth.ts` MARKETING_PUBLIC_PATHS.)
- **B2. Deploy.** `vercel deploy --prod` from the repo. Production already has the DB
  keys and the two marketing tables, so the pages and the capture go live together.
- **B3. Domain.** Decide: a subpath on the current domain, or point buyingmoment.com
  at it. Set up the custom domain in Vercel if you go that way.
- **B4. Consent + analytics.** Add a minimal cookie/consent line if you turn on any
  third-party analytics; the first-party tracking already needs none.

### PHASE C — Get people to the tool

The tool is the channel, but a channel needs a mouth. All of these feed the same
tool, value-first, never spammy.

- **C1. Seed it where software sellers are.** Post the free tool (the result, not a
  pitch) in a handful of relevant places (founder/RevOps communities, LinkedIn).
  Give value; let the dossier sell.
- **C2. Expand programmatic SEO.** Add more industries and, if it converts, one tool
  landing per niche ("find companies switching off [competitor]"). Real content that
  ranks and funnels.
- **C3. Build a share loop into the result.** Since the tool is the channel, make the
  dossier shareable (a "send this example to a colleague" / copy-link). Product-led
  distribution beats paid.
- **C4. One launch moment.** A single Product Hunt / LinkedIn launch once the magnet
  reliably delivers. Not before.

### PHASE D — Measure and tune

- **D1. Define the funnel you watch:** tool views -> instant reveal -> email ->
  5 delivered -> replied to a lead -> upgraded. `scripts/lp-report.ts` covers the top;
  extend it for the delivery + activation steps.
- **D2. Decide the landing test.** Either keep the three `/for/*` variants as a
  positioning A/B *within the software niche*, or focus everything on `/for/saas` and
  retire the other two. Pick based on how much traffic you can drive.
- **D3. Iterate on the weakest number.** Usually reveal -> email, or delivered -> reply.

---

## 4. Smaller open task (design, in progress)

Finish world-building the three landing pages: carry the tool's dossier treatment,
depth, and motion across `/for/saas`, `/for/outbound`, `/for/founders`. Started (the
signal field is in the heroes); not finished. This is polish, not critical path.

- _Drop-in:_ "/impeccable — finish the world-building on the three landing pages in
  app/for/[niche], matching the depth and dossier treatment of the free tool at
  app/tools/buying-moment-check. Keep the three accent worlds."

---

## 5. The research and insight to draw on

Everything below already reasoned-through; don't redo it, build on it.

- `docs/gtm-strategy.md` — full positioning, packaging, pricing, unit economics, GTM,
  and the grand-slam offer, with sources and competitor price anchors.
- `docs/ideation/buying-moments-landscape.md` — ~80 candidate buying moments ranked,
  and the "reframe" pattern (a public record built for buyer A, handed to buyer B).
- `docs/GTM-CONTEXT.md` — the strategic context and the earlier decision history.
- `docs/OVERNIGHT-BUILD-SUMMARY.md` — what was built in the first pass and how it was
  verified.

**The three insights that matter most:**
1. The edge is not the signal, it is the **stacking + the finished last mile** (the
   cited brief and the ready email). Show the stack; sell the last mile.
2. **The magnet must give a real result**, not information about a result. Five real
   leads beats any playbook. That is why Phase A is the whole game.
3. **Time-to-value is the killer.** Deliver something real within 24 hours or the
   trial dies. Instant reveal + fast delivery is the design, on purpose.

---

## 6. Decisions only you can make

1. **Brand name + USPTO.** "Buying Moment" is a working name; it is descriptively
   weak and near Revenue.io's "Moments." Search before you invest in it.
2. **Final pricing** for the software-seller buyer.
3. **Three landing variants or one?** Keep the A/B, or focus on `/for/saas`.
4. **Email sender** for the delivered package (Resend / Postmark / HubSpot).
5. **How real the "5 leads" are at launch** — fully automated (Phase A done) vs. a
   manual-first fulfillment while the automation lands. True self-serve is the goal;
   a short manual bridge is an acceptable start if it gets you to real feedback faster.
