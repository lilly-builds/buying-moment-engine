# Research — Email Finder & Enrichment (buy vs build) for the Buying-Moment Engine

**Purpose:** Decide how the engine turns a *person + company* into a *deliverable email*, given PDL is already the enrichment anchor. Captures the tool landscape, the buy-vs-build call, and — most importantly — the **data triggers** that tell us when (and only when) to add another tool.

**Status:** Decision record. **Date:** 2026-07-08.

---

## TL;DR — the decision

1. **Buy, don't build.** The email data lives in private databases we can't recreate, and reliable verification is an IP/infrastructure problem, not a code problem. Building loses on both coverage and deliverability.
2. **Start with PDL alone.** We already have it wired. Don't add a second tool on theory.
3. **Measure two numbers** (the triggers below). **Add a tool only when a trigger fires** — not before. We may need neither; we may need only a cheap verifier.

**Heuristic: don't add a tool to fix a problem you haven't measured.**

---

## The two data triggers (the actionable core)

Run our real leads through PDL and watch exactly two numbers. Each has a threshold and a specific fix. Nothing gets added unless its trigger fires.

| # | Metric | What it means | Trigger (rough) | If it fires → add | If it's fine → |
|---|---|---|---|---|---|
| **1** | **Coverage** | % of leads PDL returns an email for | **< ~60–70%** | **more sources** — a waterfall aggregator (Bettercontact / FullEnrich) or a 2nd finder | PDL's coverage is enough — add no sources |
| **2** | **Bounce rate** | % of PDL's emails that bounce on send | **> ~2–3%** | **a verifier** (MillionVerifier / ZeroBounce, ~$0.004/email) | PDL's emails are safe to send — add no verifier |

**Why these thresholds:**
- **Coverage < ~65%** means we're leaving too many reachable buyers on the table; the cost of a broader source waterfall is justified by the incremental pipeline.
- **Bounce > ~2–3%** is the danger zone for sender reputation — above it, deliverability of *all* our mail degrades. A ~$0.004/email verify pass is cheap insurance.

**The point:** these two triggers are independent. Weak coverage ≠ needing a verifier; high bounce ≠ needing more sources. Fix only the number that's actually bad.

---

## Does PDL verify? No — and this is the key clarification

Two different jobs:

- **Find the email** — hand back the address on file for a person. **PDL does this.** It does light hygiene (valid format, dedupe) but not deliverability.
- **Confirm it won't bounce** — check the mailbox is live *today*. **PDL does NOT do this.** Its emails come from a dataset that can be stale (person left the company, mailbox disabled), so a real-time/bounce-history verifier is a separate capability.

So PDL answers *"here's an email we have,"* not *"this will land in the inbox right now."* Whether that gap matters is exactly what **Trigger 2 (bounce rate)** measures.

---

## The tool landscape (reference — only pull from here when a trigger fires)

### If Trigger 1 fires — more FIND sources
Ordered by cost÷hit-rate; PDL stays the anchor, these fill its gaps. Prefer **pay-per-*verified*-email** billing (misses are free).

| Provider | Model | Billing | Role | ~Cost/hit |
|---|---|---|---|---|
| **PDL** (anchor) | Aggregated DB | pay-on-match | Primary — email + firmographics + LinkedIn in one call | ~$0.01–0.10 |
| **Prospeo** | Proprietary DB | PAYG | Cheap 2nd; strong LinkedIn-URL → email | ~$0.01–0.05 |
| **Findymail** | DB + verify | **pay per verified** | Bulk, agency-grade, misses free | ~$0.01–0.02 |
| **Anymailfinder** | Finder | **pay per verified** | Clean verified-only billing | ~$0.01–0.03 |
| **Apollo** | Contributory DB | credits (paid API) | Broadest coverage sweep for deep misses | cheap/credit |
| **Dropcontact** | Real-time compute | PAYG | EU/GDPR-compliant finds | ~€0.01–0.04 |

### If Trigger 2 fires — a VERIFIER
Cheapest-bulk primary; a premium verifier only for ambiguous/high-value addresses.

| Provider | Niche | ~Cost/verify |
|---|---|---|
| **MillionVerifier** | Cheapest bulk | ~$0.0006–0.002 |
| **NeverBounce** | Cheap, solid API | ~$0.003–0.008 |
| **ZeroBounce** | Bounce-history ground truth | ~$0.004–0.008 |
| **Kickbox** | Premium accuracy (Sendex) | ~$0.005–0.01 |
| **Bouncer** | EU/GDPR-friendly | ~$0.004 |

### Waterfall aggregators (the "buy the whole thing" option, if coverage needs many sources)
These *are* a pre-built find+verify waterfall over ~20 sources — one API instead of stitching several. Cheaper and more dev-friendly than Clay.

- **Bettercontact** — 20+ sources, API-first, pay-per-verified, ~$0.02–0.05/email.
- **FullEnrich** — 15+ sources, waterfall incl. phones, pay-per-found.
- **Enrow** — waterfall, verified-only billing.
- **Clay** — same concept, richer no-code UI, but pricier for programmatic use.

> ⚠️ An aggregator is **another vendor + another step + another bill.** Only worth it if Trigger 1 shows PDL's coverage is genuinely short. Don't add it preemptively.

*(All pricing directional — verify current + negotiate at committed volume.)*

---

## Cost levers (once we do add tools)

- **Cache everything** (email + verdict + timestamp; re-verify after ~90 days). Never re-pay for a known lead — the single biggest cost cut.
- **Pay-per-verified billing** — Findymail / Anymailfinder / Bettercontact / FullEnrich bill only on a verified hit, so cost tracks yield, not attempts.
- **Cost÷hit-rate ordering + short-circuit** — cheapest source first, stop the moment you have a confident email.
- **Free DNS/list pre-filter** — syntax + MX-provider fingerprint + role/disposable/free lists drop obvious junk *before* spending a verify credit; needs no infrastructure.

---

## Recommended path

1. **Now (prototype):** run 20–30 real leads through **PDL alone**; record **coverage %** and **bounce %**.
2. **Read the triggers:**
   - Coverage fine + bounce fine → **ship on PDL only.** Add nothing.
   - Bounce high, coverage fine → add a **cheap verifier** (MillionVerifier/ZeroBounce). Nothing else.
   - Coverage low → add **sources**: a waterfall aggregator (Bettercontact/FullEnrich) or 1–2 finders.
3. **At scale (10k+/mo, sustained):** move whatever we're using onto committed-volume contracts, keep the cache + free pre-filter, and buy all verification (own-SMTP does not scale — port 25 blocks, IP reputation). Never build verification infra.

---

## Why NOT build

- **Data moat is unbuildable** — incumbents' value is years of crawling + millions of contributory inboxes + licensing. Day one our DB is empty; theirs isn't. No architecture closes that gap.
- **Verification is infra, not code** — the SMTP logic is ~40 lines, but *reliable* results need warmed IPs with clean reverse-DNS (port 25 is blocked on AWS/most ISPs) + historical bounce data. Capital + data, not engineering.
- Full build only makes sense if email data becomes a **product we sell** — not for an internal enrichment step.

---

## Honest note

We circled the field (PDL → Hunter/ZeroBounce → aggregators → Clay → back to PDL) and the conclusion is the disciplined one: **we already have the anchor (PDL); measure the two triggers on real data; add exactly the one tool a fired trigger calls for, and nothing else.** The value of this doc is the triggers — they turn "which of a dozen tools?" into "measure two numbers, then decide."

**Next action:** run the PDL-only measurement (coverage % + bounce %) on a real lead sample.
