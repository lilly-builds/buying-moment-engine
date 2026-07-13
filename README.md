# GTM Maestro: the Buying-Moment Engine

GTM Maestro catches companies the day they tip into ready to buy what you sell, then hands your reps everything they need to close the deal: a researched call brief, the exact buying signal, the decision maker's contact, and the first email sequence.

Every lead tool sorts companies by who they are: their industry, their headcount, their tech stack. But no one buys because they fit a category. They buy the moment a need strikes: a tool breaks, a new leader lands, or they outgrow what they had. GTM Maestro maps your product's real buying moments, then watches multiple public sources around the clock to catch companies the instant they hit one, so you reach out first, while the need is still fresh.

![GTM Maestro: the signal sources merging, then dissolving into the live feed of practices at a buying moment](docs/screenshots/hero-tour.gif)

---

## The user story it is built around

The whole thing is built around one rep's wish:

> As an account executive, I want to be handed a steady stream of prospects
> that are hitting a buying moment right now, each with a research-backed, personalized brief, so I can
> get on a call or send outreach already informed, without spending my time researching.

The feed hands them a queue of real practices that just hit a buying moment, and each one shows up with the
brief already written and facts cited.

![The feed of real practices at a buying moment, hottest on top](docs/screenshots/feed.gif)
*The push feed: real named practices at a buying moment, ranked so the hottest rise to the top.*

---

## The thesis: the sale is all about timing.
Most outbound starts from a list of companies that fit a profile, then blasts them. It mostly gets
ignored, because fitting a profile is not the same as being ready to buy. A lot of buying comes down
to timing. A need shows up, and there is a short window. Be the first company to catch that window and 
more people say yes.

So the engine watches for the trigger event: the public signs that a prospect is about to
need help. For an AI platform that supports with key operations, a few buying moment signals we can pull from include:

- They are hiring for the front desk. A rush to hire patient coordinators or call-center staff
  usually means they cannot keep up with the phones, which is exactly the opening.
- Patients are complaining they cannot get through. Reviews that say "on hold forever" or "no one
  answers" are people reporting the phone problem themselves.
- They just grew. An acquisition, a new location, or new doctors means more patients than the front
  desk was built to handle.

Multi-signal Scoring for Prospects:
When a practice shows up on one signal, the engine turns around and checks the others for that same
clinic: is it also hiring front-desk staff, also in the news for a new location or an acquisition,
also collecting reviews about no one answering the phone? Any signal that fires and can be cited gets
stacked onto that practice, so a lead that first came in on reviews can grow into a two- or
three-signal lead. The engine only stacks a signal when the name and location match the practice it
already has, so a similarly named but different clinic never gets folded in by mistake. These checks
only run for practices that already qualified, and every paid lookup gets logged with its cost, so
the cross-checking stays cost-effective. 

The feed ranks practices by how many different fresh signals are firing, using freshness to break
ties. A practice with three live triggers sits above one with a single fading trigger, so the rep
always works the strongest accounts first. The full list of what the engine detects today, what is
built but parked, and where the signal layer is headed lives in
[`docs/signal-catalog.md`](docs/signal-catalog.md). The deeper, code-level guide to the signal system
is in [`docs/data-signal-system.md`](docs/data-signal-system.md).

---

## The full workflow

This is a full go-to-market engine, not just a research helper. This system: 
> finds prospects based on key buying moment signals, like an acquisition or new hire posting that your software can support >>
> drafts a customized email sequence >> 
> prepares a sales call brief with citations for the Account Executive to save time on research >> 
> sends email sequence and tracks touchpoints with Hubspot CRM integrtion >>
> measures the meetings booked and deals won from these prospects to measure and optimize ROI. 

---

## What's in a prospect brief, and why you can trust it

Every prospect comes with a ready-to-use sales cheat sheet.

- Send email is the "act now" side. It gives you a customized three-message email sequence you can edit in your own words before it goes out.

- Prep for call is the "get ready" side. It's the whole picture of the practice, the proof point and the ROI numbers, a few discovery questions to ask, and the top objections you'll hear with the rebuttals already written.

Every fact in a brief is underlined and linked to the exact source
it came from, and that link is checked before the brief is ever saved. This is the hard part, and it
genuinely works this way:

- While the engine gathers facts, it keeps a fact only if the exact words show up on the page it
  actually read. Anything it cannot match word for word gets dropped, not guessed at.
- Before a brief is saved, it has to pass three checks: is it shaped right, does every claim have a
  citation, and is each claim actually backed by its source. A brief whose claims cannot be traced to
  a source is not saved at all.
- Each citation jumps you to the exact sentence on the source page, so a rep can confirm any line in
  a second instead of taking the tool's word for it.

That is what lets a rep act on a brief without double-checking it. The whole promise is that the rep
can trust it, so they don't waste time questioning the results of under-engineered research prompts dropped into AI. 

![An open brief with a source citation clicked open](docs/screenshots/brief-citation.gif)
*A brief with a citation opened. Every fact links to its source, checked word-for-word before the brief was saved.*

---

## The ROI scoreboard: what you measure improves. 

Every business has two goals: close more deals, and spend less to win each one. Those are the two numbers this tool is judged on. You can't steer by them directly, though, because they only show up later, after a deal is won or lost. So the scoreboard is built the way any operator would build it. The two end goals sit up top, and underneath them are the early signs that move them, each one tied to a decision it lets you make.

The two end goals (lagging metrics):
- Deals won. Are we closing more?
- Cost to win a customer (CAC). Does each new customer cost less?

The leading metrics that give data to guide optimizations that ultimately increase revenue and decrease CAC.
┌────────────────────────────────────────────┬───────────────────────────────────────┬───────────────────────────────────────────────────────────────────────────┐
│                 The metric                 │        The question it answers        │                         The move it lets you make                         │
├────────────────────────────────────────────┼───────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────┤
│ Per-signal conversion rate                 │ Which buying signals turn into        │ Keep the signals that pay off, kill the ones that do not, and re-rank the │
│                                            │ meetings?                             │  feed around them                                                         │
├────────────────────────────────────────────┼───────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────┤
│ Win rate, cost per meeting, and cycle      │ Which specialties win fastest and     │ Put reps and budget on the specialties that convert, and rework the pitch │
│ time, by specialty                         │ cheapest?                             │  for the ones falling behind                                              │
├────────────────────────────────────────────┼───────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────┤
│ Messages to land a meeting                 │ How many messages does it take to     │ Fix the sequences that are not landing                                    │
│                                            │ land a meeting?                       │                                                                           │
├────────────────────────────────────────────┼───────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────┤
│ Cost per meeting                           │ What does each booked meeting cost?   │ Put budget where meetings are cheapest                                    │
├────────────────────────────────────────────┼───────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────┤
│ Lead-quality feedback, thumbs up or down   │ Did the AE mark the lead good or not? │ Learn what a good lead looks like, so the engine finds more and wastes    │
│                                            │                                       │ less                                                                      │
└────────────────────────────────────────────┴───────────────────────────────────────┴───────────────────────────────────────────────────────────────────────────┘

Metrics per customer segment:
Every number is viewable for the whole book of business or one specialty at a time, so you can see which vertical is carrying the result.
  
---- The full
math behind every number is in [`docs/scoreboard-metrics.md`](docs/scoreboard-metrics.md).

![The ROI scoreboard, scrolling from the headline numbers through per-signal, per-specialty, feedback, and the big test](docs/screenshots/scoreboard.gif)
*The scoreboard. Every number carries a measured or modeled tag, and an empty metric shows a dash instead of a fake number.*

---

## Onboarding: walks you through the need-to-know features:

![The guided onboarding tour step card](docs/screenshots/onboarding.png)
*The guided tour: a branded step card (glowing orb, one-word instruction, context chip) over the real feed.*

### Connecting your tools

The only setup anyone (typically the RevOps leader) actually does lives on the Connections page (`/integrations`).
There are three integrations:

- HubSpot: one secure click (OAuth, so no passwords get shared). That single connection turns on
  three things at once: it pushes and tags the tool's leads into the CRM, sends the approved outreach
  through the rep's own inbox, and pulls in the open, click, and reply tracking that rides along with
  the send. One connection feeds one clean stream of data into the scoreboard, instead of duct-taping
  three tools together.
- Anthropic and People Data Labs: paste your own key for each, and each is encrypted where it is
  stored. These power the prospect enrichment, verification, research, and brief writing.

Until a company connects its own accounts, the whole tool runs on the builder's demo keys (except for hubspot), so someone
evaluating it sees the full value first and gets new leads daily for a week. Connecting flips two features on. 

(1) Emails can be sent and tracked through a company's CRM. 

(2) AI-driven research and brief-writing continues beyond week one trial. Once the Anthropic key is connected, API calls now bill to the
company's own account, so it shows up as real, measured cost in the scoreboard's CAC. 

Step-by-step is in [`docs/revops-connections-guide.md`](docs/revops-connections-guide.md).

![The Connections page: HubSpot OAuth plus Anthropic and PDL key setup](docs/screenshots/integrations.gif)
*The Connections page (`/integrations`): one secure click for HubSpot, two pasted keys for the engine. The only setup anyone does.*

---

## How it works (architecture)

```
  Discovery + detectors            Enrichment waterfall           Synthesis + feed
  ---------------------            --------------------           ----------------
  Adzuna  (staffing spike) ─┐      Claude reads the real     ┐    Cited two-tier brief
  GDELT   (growth events)  ─┼──▶   site + finds the signals  ├─▶  persisted in Postgres
  Google Places (reviews)  ─┘      PDL fills verified gaps   ┘    Ranked push feed + pull
                                   (work email, LinkedIn)         ROI scoreboard
```
*Google Places phone complaints are live through the discovery path, and the standalone per-place
review reader is also there for targeted cross-checks when a place's ID is already known.*

- The stack (the main tools it is built on): Next.js and TypeScript for the app, a Supabase Postgres
  database reached through Drizzle, Anthropic's Claude for the research and brief writing, People Data
  Labs for verified contact info, and HubSpot for the CRM and email send, all on that one OAuth
  connection.
- The enrichment waterfall. "Waterfall" just means it does the cheap step first and only pays for the
  expensive one to fill gaps. Claude does the web research: it reads the practice's real website and
  reviews, finds the buying-moment signals, and cites every fact. Then People Data Labs fills only the
  few gaps Claude cannot reliably get on its own, like a work email or a LinkedIn URL. Claude first,
  PDL for the leftovers, so the cost stays low.
- The data layer. It is a tidy Postgres database that acts as the single source of truth. Every fact
  carries its origin (the source URL and the moment it was spotted). Loading data is idempotent,
  meaning you can run it twice without creating duplicates. Raw data is kept separate from anything
  derived from it. Every table has row-level security (RLS), which are database-enforced walls so one
  customer's data can never leak into another's. And there are built-in tag columns (specialty, which
  signal, lead quality) so any scoreboard number can be sliced by specialty instantly. This is what
  makes the cited briefs and the per-specialty ROI real instead of cosmetic.
- Send, done right. The rep edits the drafted email in the dashboard. The full edited text rides along
  on one HubSpot field into a Sequence enrollment, so it sends from the rep's own inbox with native
  open, click, and reply tracking, while still shipping the exact words the rep wrote. That one OAuth
  connection covers the CRM, the send, and the tracking. Every stored token and pasted key is
  encrypted where it sits, using AES-256-GCM (a strong, standard encryption method).
- Cost is a live number. Every paid API call (Claude, PDL, the detectors) is logged with its cost the
  moment it happens, into a `cost_events` table. So the CAC on the scoreboard is real spend, not a
  number someone tallied by hand.
- Scheduled runs. A Vercel Cron timer (a scheduled job, set for 8am on weekdays) is wired up to fire
  the whole engine each weekday morning. It is built and merged, but it stays asleep until its
  `CRON_SECRET` is set in the deploy, so it cannot fire by accident.

---

## Getting started

You'll need Node 20+, pnpm, and a Postgres database (Supabase).

```bash
pnpm install
cp .env.example .env.local     # fill in the keys named there
pnpm db:migrate                # apply the schema
pnpm db:seed                   # optional: seed a demo dataset
pnpm dev                       # http://localhost:3000
```

Every page renders on a fresh clone even without any keys, using the designed empty and all-zero
states, so you can walk through the whole app first. To run the engine against real data (find
practices, enrich them, write briefs):

```bash
pnpm pipeline                  # supports --dry-run and --limit N
```

Other commands: `pnpm test` (over 900 automated tests across 84 files, covering the engine, brief
writing, the data layer, and the send path), `pnpm typecheck`, `pnpm build`.

Keys: `.env.example` lists every key the project uses and what it is for. The engine needs an
Anthropic key (for the research and the brief writing voice) and, ideally, a PDL key (for verified
contacts). HubSpot is an OAuth connect, and you only need it for live send and CRM tracking.
Everything else runs without it.

> A note on this app's Next.js: this project runs a modified build of Next.js. Read `AGENTS.md`
> before touching framework code.

---

## Docs

- [`docs/spec.md`](docs/spec.md) - the full product spec: the user story, the decision log (D1-D15), the signal catalog, and the locked stack
- [`docs/signal-catalog.md`](docs/signal-catalog.md) - every buying signal: built, parked, and the roadmap
- [`docs/data-signal-system.md`](docs/data-signal-system.md) - how the live signal engine fetches, classifies, resolves, de-dupes, meters, and ranks signals
- [`docs/scoreboard-metrics.md`](docs/scoreboard-metrics.md) - the exact math and honesty tag behind every scoreboard number
- [`docs/revops-connections-guide.md`](docs/revops-connections-guide.md) - the one-time admin setup (OAuth plus keys)
- [`docs/hubspot-send-setup.md`](docs/hubspot-send-setup.md) - the HubSpot send configuration
- [`docs/adapt-to-proptech.md`](docs/adapt-to-proptech.md) - how the same engine adapts to a new industry
- [`docs/loom-walkthrough-outline.md`](docs/loom-walkthrough-outline.md) - the walkthrough script (product tour plus rollout)
