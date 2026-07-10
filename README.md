# GTM Maestro: the Buying-Moment Engine

**A live feed of healthcare practices hitting a buying moment right now, each with a verified,
source-linked brief that is ready to work.** An account executive opens the app and starts
selling. They do not start researching.

**Live demo:** LIVE DEMO URL: `<pending - confirm deploy>`

![GTM Maestro: the guided tour playing over the live feed](docs/screenshots/onboarding-tour.gif)

---

## The story it is built around

> As an account executive on the healthcare team, I want to be handed a **constant flow of
> practices hitting a buying moment right now**, each with a **verified, ready-to-use,
> personalized brief**, so I can get on any call or send any outreach **already confidently
> informed, without spending my time researching.**

That is the whole product. A rep should never open a blank page. The feed hands them a queue of
real practices that just did something that means they are ready to buy, and each one arrives with
the brief already written and every fact cited.

![The feed of real practices at a buying moment, hottest on top](docs/screenshots/feed.png)
*The push feed: real named practices at a buying moment, ranked so the hottest rise to the top.*
<!-- TODO: Lilly drops this shot - docs/screenshots/feed.png (see SHOT-LIST.md) -->

---

## The thesis: sell on the moment, not the list

A cold list answers *"who fits the profile?"* Most outbound stops there, and most outbound is
ignored, because fitting a profile is not the same as being ready to buy. A lot of buying is
**timing**. Something happens, a need appears, and there is a window. Find that window and
conversion goes up.

So the engine sells on the **trigger event**. It watches public data for the moments that mean a
healthcare practice is about to need front-desk and patient-communication help:

- **They are hiring for the front desk.** A staffing spike for patient coordinators or call-center
  roles means they cannot keep up with the phones. That is exactly the wedge.
- **Patients are complaining they cannot get through.** Reviews that say "on hold forever" or
  "no one answers" are acute, self-reported phone pain.
- **They just grew.** An acquisition, a new location, or new providers means new patient volume
  the front desk was not built for.

The feed ranks practices by **how many distinct fresh signals are firing** (freshness breaks ties),
so a practice with three live triggers outranks one with a single fading trigger and the AE always
works the strongest accounts first. The full catalog of what the engine detects today, what is
built but parked, and where the signal layer is going next lives in
[`docs/signal-catalog.md`](docs/signal-catalog.md).

---

## What is inside a brief, and why you can trust it

Every practice carries a brief with two tiers you toggle between: one built to send from, one built
to prep from.

**Send email**
- The **buying-moment headline** and who to contact: the real decision-maker, their role, and the
  best channel
- The **recommended action:** a call opener and an **editable three-touch outreach sequence**
  (initial plus two follow-ups) you edit inline, so your exact words ship

**Prep for call**
- The buying moment with each signal's freshness and a **confidence badge per signal**
- Practice profile: locations, EHR, patient volume, front-desk load, and incumbent tooling
- The EliseAI-fit pain line, a real proof point, and an ROI range
- Two or three discovery questions and the top three objections with rebuttals
- The signal-source tag on each fired signal (which pipeline surfaced it)

**The trust mechanism: every fact is underline-linked to its source, and the link is verified
before the brief is ever stored.** This is the part that is genuinely hard, and it is real:

- During enrichment, a fact is kept only if its snippet appears **verbatim** on the page the engine
  actually fetched. Anything that cannot be matched word-for-word is dropped, not guessed.
- During synthesis, a brief passes three gates (shape, citation-closure, and truth) before it is
  saved. A brief whose claims cannot be grounded in its sources is **not persisted at all.**
- Each citation deep-links to the exact sentence on the source page, so a rep verifies any line in
  a second rather than taking the tool's word for it.

That is what makes a brief safe to act on without re-checking. The product's whole promise is that
a rep can trust it, so the trust is built in code, not asserted in copy.

![An open brief with a source citation clicked open](docs/screenshots/brief-citation.png)
*A brief with a citation opened. Every fact links to its source, verified verbatim before the brief was stored.*
<!-- TODO: Lilly drops this shot - docs/screenshots/brief-citation.png (see SHOT-LIST.md) -->

The briefs cover **four verticals**, each with its own authored pack (the pain line, opener, proof
point, EHR-as-signal, and ROI benchmark): Dermatology, Women's Health / OB-GYN, Ophthalmology, and
Orthopedics. Where a real, citable proof point does not exist yet (orthopedics), the pack ships an
honest `proof_pending` marker rather than a fabricated one. The engine and brief frame are
identical across all four; a vertical is a different pitch, not a different product.

---

## Proof it is working: the ROI scoreboard

The tool grades its own impact. The scoreboard is scoped to *this tool's* effect, not a generic
company dashboard, and it is written so an eighth-grader gets every number at a glance. The
deciding rule: a number is on the screen only because it drives an action.

It answers the questions that move revenue and CAC: which signals turn into meetings, which
specialties win fastest and cheapest, how many messages it takes to land a meeting, what each
booked meeting costs, and whether the AE marked each lead good or not. Every figure is viewable in
aggregate and per-vertical.

**The honesty tags are the point.** Each number is tagged **measured** (read straight off the
tool's own logged activity and metered spend) or **modeled** (an honest projection from public
benchmarks, sharpened into measured as real volume grows). We never dress a projection up as a
measurement. When there is no data yet, a metric shows a dash, never a fabricated figure. The full
calculation for every number is in [`docs/scoreboard-metrics.md`](docs/scoreboard-metrics.md).

![The ROI scoreboard, scrolling from the headline numbers through per-signal, per-specialty, feedback, and the big test](docs/screenshots/scoreboard.gif)
*The scoreboard. Every number carries a measured or modeled tag; empty metrics degrade to a dash, never a fake.*

---

## Onboarding and rollout: full value before a single key

The whole tool runs before anyone connects anything. The feed, the briefs, the inline editing, and
the scoreboard all work on the builder's own keys out of the box. A hiring manager or an AE has zero
setup, and an AE can mark any lead good or not with a one-tap thumb.

A first-time AE gets a guided **"work your first lead"** tour, rendered as brand step cards (a
gradient orb with the step icon, a one-bold-word instruction, and a context chip). It coaches them
over the real feed and a real brief, and it is fully skippable.

![The guided onboarding tour step card](docs/screenshots/onboarding-tour.gif)
*The guided tour: a brand step card (gradient orb, one-bold-word instruction, context chip) over the real feed.*

### Connecting the stack

The only setup anyone does lives on the **Connections page** (`/integrations`), and this is where the
JD's "integrate with the tools in their stack" work is real. It is three rows:

- **HubSpot** — one OAuth click. That single grant turns on **three things at once**: pushing and
  tagging tool-sourced leads in the CRM, sending the approved outreach through the rep's own inbox,
  and the native open/click/reply analytics that ride the send. One connection, one pipeline of data
  for the scoreboard, instead of stitching three tools together.
- **Anthropic** and **People Data Labs** — paste-your-own-key, each encrypted at rest. These power the
  research, the brief voice, and the verified contact data.

Until an org connects, the whole tool runs on the builder's demo keys, so an evaluator sees full value
first. Connecting flips two things: the AI spend now bills to the org's own account (so it shows up as
**real, measured cost** in the scoreboard's CAC), and send plus CRM writes reach the org's systems. The
Send button on a brief is the demand-driven nudge that routes a rep's request to the RevOps owner who
does this one-time setup. Full step-by-step: [`docs/revops-connections-guide.md`](docs/revops-connections-guide.md).

![The Connections page: HubSpot OAuth plus Anthropic and PDL key setup](docs/screenshots/integrations.png)
*The Connections page (`/integrations`): one OAuth click for HubSpot, two pasted keys for the engine. The only setup anyone does.*
<!-- TODO: Lilly drops this shot - docs/screenshots/integrations.png (see SHOT-LIST.md) -->

---

## The full loop (and what "demo mode" means)

This is a full GTM engine, not a research assistant. It finds the buying moment, drafts the
outreach, **sends it**, tracks it in the CRM, and scores the meetings booked and deals won that
come back. Landing deals is the whole point, and the ROI scoreboard is where that shows up. The
send path and the CRM push are built and tested end to end.

Two honest limits, and they apply to **this demo only**. First, the **data is real** while the
**final send is simulated**: the engine pulls real practices, real public signals, and real named
decision-makers, but in the demo it drafts and displays rather than firing live outreach. That is
a deliberate safety gate so no real clinic is ever contacted while the tool is being evaluated, and
it flips on the moment EliseAI connects their HubSpot. It is enforced in code, not by convention: a
fail-closed send firewall only ever allows a sandbox test recipient. Second, the engine only ever
touches public *business* data. There is zero patient data or PHI, ever.

---

## How it works (architecture)

```
  Discovery + detectors            Enrichment waterfall           Synthesis + feed
  ---------------------            --------------------           ----------------
  Adzuna  (staffing spike) ─┐      Claude reads the real     ┐    Cited two-tier brief
  GDELT   (growth events)  ─┼──▶   site + finds the signals  ├─▶  persisted in Postgres
  Google Places (reviews)* ─┘      PDL fills verified gaps   ┘    Ranked push feed + pull
                                   (work email, LinkedIn)         ROI scoreboard
```
*\*The Google Places review detector is built and tested but runs dark until a billed key and a
place lookup list are supplied; see the signal catalog.*

- **Stack:** Next.js + TypeScript, Supabase Postgres via Drizzle, Anthropic Claude for research and
  brief synthesis, People Data Labs for verified contact data, HubSpot for CRM and email send on a
  single OAuth grant.
- **The enrichment waterfall:** Claude does the agentic web research (it reads the practice's real
  site and reviews, discovers the buying-moment signals, and cites every fact), and PDL fills only
  the verified gaps Claude cannot reliably get (work email, LinkedIn URL). Claude-first, PDL for the
  gaps, so cost stays low.
- **The data layer:** a normalized Postgres system of record with provenance on every fact (source
  URL plus the timestamp it was detected), idempotent de-duped ingestion, raw-versus-derived
  separation, RLS on every table, and first-class tag columns (vertical, signal-source,
  lead-quality) so every scoreboard number slices by vertical instantly. This is what makes the
  cited briefs and the per-vertical ROI real rather than cosmetic.
- **Send, done right:** the AE edits the drafted email in the dashboard; the full body rides one
  HubSpot custom property into a Sequence enrollment, so it sends through the rep's own inbox with
  native open/click/reply tracking, while shipping the exact edited text. One OAuth grant covers
  CRM, send, and analytics; per-tenant tokens and pasted keys are encrypted at rest with AES-256-GCM.
- **Cost is a live number:** every paid API call (Claude, PDL, detectors) is metered at the call
  site into a `cost_events` table, so the CAC on the scoreboard is real spend, not a manual tally.
- **Scheduled runs:** a Vercel Cron heartbeat (`0 8 * * 1-5`) is wired to fire the whole engine on
  weekday mornings. It is built and merged but stays **dormant** until its `CRON_SECRET` is set in
  the deploy (fail-closed by design).

### Honest status: built, and where the line is

Everything above is built and demoable. A few pieces are deliberately gated or are the next step,
and the docs say so rather than imply more than ships:

| Piece | What is true | Where the line is |
|---|---|---|
| **Enrichment run** | Runs in the demo, wired into the pipeline, on a **manual** trigger, off the **environment** API keys | An always-on schedule is the Vercel Cron, which is built but dormant until `CRON_SECRET` is set |
| **Paste-your-own-key** | The `/integrations` key fields store an encrypted, per-tenant key | The manual pipeline reads the environment keys; a pasted key is wired only into the dormant scheduled cron (Anthropic), not the manual run |
| **Phone-complaint detector** | The Google Places review reader is fully built and tested | Runs dark until a billed Google Places key and a place lookup list are supplied; it is a lookup, not a discoverer |
| **Lead feedback** | The 👍/👎 mark renders; the data model and scoreboard support one-tap reasons and free-text | Live capture of the reasons/free-text and vote persistence is the next step; it is seeded for the demo today |
| **Send** | The full send path is built and tested (the engine's job is to send outreach and land deals) | Off for this demo only, as a safety gate so no real clinic is contacted; flips on the moment EliseAI connects HubSpot |

---

## Getting started

Prerequisites: Node 20+, pnpm, and a Postgres database (Supabase).

```bash
pnpm install
cp .env.example .env.local     # fill in the keys named there
pnpm db:migrate                # apply the schema
pnpm db:seed                   # optional: seed a demo dataset
pnpm dev                       # http://localhost:3000
```

Every page renders on a fresh clone even without keys, using the designed empty and all-zero
states, so you can walk the whole app first. To run the engine against real data (discover
practices, enrich, synthesize briefs):

```bash
pnpm pipeline                  # supports --dry-run and --limit N
```

Other scripts: `pnpm test` (over 900 automated tests across 84 files, covering the engine, brief
synthesis, the data layer, and the send path), `pnpm typecheck`, `pnpm build`.

**Keys.** `.env.example` names every key the project uses and why. The engine needs an Anthropic
key (research and brief voice) and, recommended, a PDL key (verified contacts). HubSpot is an OAuth
connect, needed only for live send and CRM tracking. Everything else runs without it.

> **A note on this app's Next.js:** this project runs a modified build of Next.js. Read
> `AGENTS.md` before touching framework code.

---

## Docs

- [`docs/signal-catalog.md`](docs/signal-catalog.md) - every buying signal: built, parked, and the roadmap
- [`docs/scoreboard-metrics.md`](docs/scoreboard-metrics.md) - the exact math and honesty tag behind every scoreboard number
- [`docs/revops-connections-guide.md`](docs/revops-connections-guide.md) - the one-time admin setup (OAuth + keys)
- [`docs/hubspot-send-setup.md`](docs/hubspot-send-setup.md) - the HubSpot send configuration
- [`docs/adapt-to-proptech.md`](docs/adapt-to-proptech.md) - how the same engine generalizes to a new vertical
- [`docs/loom-walkthrough-outline.md`](docs/loom-walkthrough-outline.md) - the walkthrough script (product tour + rollout)
