# GTM Maestro (Buying-Moment Engine): Product Spec

**Doc type:** Requirements spec *(in progress)* · **Date:** 2026-07-07
**The rule:** every requirement in this doc must serve **User Story ①**. If it doesn't serve the story, it's out of scope.

> **Implementation status vs this spec (2026-07-14, COV-11).** Two inputs this spec describes are
> specified but **not yet built**, so the code is the source of truth here:
> - **HubSpot open/click/reply webhook ingestion** (§ Stack, line ~314). There is no webhook route
>   (`app/api/hubspot/` holds only `oauth`, `oauth/start`, `send-config`), so no email-engagement
>   event is captured yet.
> - **AE 👍/👎 feedback persistence.** `app/api/feedback` is an auth-gated **stub** that persists
>   nothing (the `feedback` table exists in the schema, but nothing writes to it).
>
> Consequence: the ROI scoreboard's *engagement* and *feedback* inputs have no ingestion path yet, so
> those columns read honestly empty rather than fabricated. Both are parked pending a product decision
> (build vs keep parked); this note keeps the spec and the code in agreement in the meantime.

---

## User Stories

### ① The product story — *the anchor*

> As an **Account Executive** on EliseAI's healthcare team, I want to be handed a **constant flow of practices hitting a buying moment right now** — each with a **verified, ready-to-use, personalized brief** — so that I can get on any call or send any outreach **already confidently informed, without spending my time researching.**

*The **GTM Engineer / RevOps** layer is the "how" behind this story — the engine and plumbing that make this experience real for the AE.*

---

## Draft 1 Idea Discussion on how to deliver this - not absolute or locked in 


- "Account IQ" · the one-paste healthcare account brief ← the obvious
winner

▎ Elevator: A rep types ty seconds later they have a one-screen, battle-ready brief: number of locations, which EHR/scheduling  system they run, patiepain EliseAI solves forthat vertical, a personalized opener, the top 3 objections with rebuttals,   and the ROI number — salks into their first call sounding like a veteran.                                                     
▎ User story: "As a new SDR on the healthcare team, I want to paste a clinic's name and instantly getpersonalize outreachwithout spending an hour researching a world I don't know yet."
▎
▎ ROI meter: research minutes saved per account · % of briefs that lead to a booked meeting · reps' vs. after.

- "Signal→Send" outbound, now with arep-facing approve/edit screen)                                                
▎ Elevator: Pull the healthcare ICP → enrich with buying signals (locations,    funding, hiring, tech  hyper-personalizedmulti-touch sequence → the rep approves or tweaks in one click → demo-mode    books the meeting. Higrement bullets).
▎                                                                               User story: "As an SDRrafts waiting for me eachmorning so I approve and send instead of writing from a blank page."    

What I'm leaning towards is a mix of number one and number two.
	1	Number one is something that is run by a user and it seems really valuable especially if we can get beyond generic research and find more nuanced details to fill out the account data. I'm interested because I've been thinking through this new idea in terms of signals for outbound systems being not only demographic-based but timing-based because a lot of the reasons we buy are timing-related. There's a certain moment that triggers the need to buy something so if you can identify what that moment is for this type of product then you will have a much higher conversion rate on that outbound engine. One example of this was for a browser use agent for insurance companies. There was a regulation change that made the timeline to deliver on certain work much shorter (24 to 72 hours) and insurance companies were laying off staff so they had more need for tools to help meet those regulation requirements. They also had to report their data publicly so we can find that signal of which trade companies are falling behind on that regulation and reach out based off of that timing-based. That's why I'm interested in number two.

	2	Number two can definitely be integrated into number one. It's kind of like the autonomous layer that cuts out the person who's coming in and dropping a lead source in to get the enriched brief so they can run in parallel with the manual component and also just the automated finding of leads. It's also really interesting that there's already proven ROI on speed-to-lead systems so if their current software doesn't cover that, that's what I would lean towards more.

	3	Whatever tool we need, we build needs that ROI scoreboard so that is not really going to count as a full idea. Other than if it could be so quick to integrate all of their current marketing data and immediately be able to give metrics as to what's creating the biggest, but then that gets into just a generic analytics dashboard that doesn't turn the data into use. So I'd rather just build our live dashboard for the tool we make.     


---

## Requirements Discussion — decision log

*A running log of the requirements interview: every question, the options weighed, and what we decided — the "why" behind the distilled requirements. Newest decisions appended as we go.*

**Legend:** ✅ Decided · 🟡 Conditional (research-gated) · ⬜ Open (awaiting your call) · 🪑 Future potential (documented, not built for the demo)

### D1 — The brief's anchor  ✅
**Q:** When an AE opens a brief, what's the headline the whole card is built around?
**Options weighed:** buying moment · practice profile · recommended action · pain + EliseAI fit.
**Decided:** **Buying-moment headline first** → then the **recommended action** (call opener + a 3-touch outreach sequence: initial message + 2 follow-ups) → **who to contact** (decision-maker + a unique personalization snippet) → practice profile & EliseAI-fit as supporting detail. *The timing thesis is the visible spine of the product.* *(Recommended-action + who-to-contact detail refined in D7.)*

### D2 — What makes it "verified"  ✅
**Q:** What makes the AE trust the brief enough to act without re-checking it?
**Options weighed:** cited claims · confidence score · vetted-before-ship · freshness stamp.
**Decided:** **Every claim is underline-linked directly to its source** — one click to verify quality, or to dig deeper into any claim.

### D3 — Which buying-moment triggers we detect  ✅ / 🟡
**Q:** Which triggers should the demo actually detect and showcase?
**Decided to build:** Front-desk staffing spike · Phone-complaint reviews · Growth events.
**Conditional 🟡:** Regulation deadline — research it; integrate **only if** a specific rule is timely, relevant to EliseAI's wedge, and significant. Otherwise it stays on the bench.
**Directive:** document every chosen signal clearly → see **Signal Catalog** below.

### D4 — Additional creative public-data signals  ✅
**Q:** Which creative, public-data signals should we build in (vs. bench)? Each is a different *kind* of signal, not a variation of the three above.
**Decided:** **Build none of these for the demo — keep all four documented as future potentials** (Signal Catalog status 🪑). The demo ships the three built signals from D3 only; these stay written-up and defensible so the roadmap is visible without stretching demo scope.
**Documented as future potentials:**
- **New ops leadership** *(PEOPLE)* — a new practice manager / administrator / COO appears (LinkedIn job-changes, announcements). A new decision-maker in their first 90 days is a classic buying window.
- **Long "next available"** *(CAPACITY)* — the booking widget / Zocdoc / Healthgrades profile shows the next open appointment weeks out. Direct proof the schedule is overwhelmed → EliseAI scheduling + virtual-waitlist pitch.
- **Patient-access tech gap** *(INTENT)* — BuiltWith/Wappalyzer shows they just added (in-market) or conspicuously lack (greenfield) online scheduling / a patient portal.
- **Peer adoption / FOMO** *(SOCIAL PROOF)* — a same-specialty, same-metro practice just publicly adopted AI patient comms (case study, press).

### D5 — The engine: pull vs. push  ✅
**Q:** The engine runs two directions — pull (rep pastes/selects a practice → brief) and push (engine autonomously surfaces practices at a buying moment → ranked feed). For the demo, which is the hero the AE opens into?
**Options weighed:** push-first (live feed) · pull-first (paste a name) · both co-equal.
**Decided:** **Push-first — the live ranked feed is the hero / home screen.** The AE opens into a feed of practices that just hit a buying moment, each with its brief ready to work — literally "handed a constant flow." Pull (paste/select a practice) stays a secondary mode. In demo-mode the feed is pre-seeded with real named practices, so it's fully demo-able.

### D6 — Vertical coverage  ✅
**Q:** Which of EliseAI's four healthcare verticals anchors the demo, and how much coverage?
**Options weighed:** deep hero + tagged spread · all four equal depth · one vertical (derma).
**Your clarifying questions — kept, because they drove the architecture:**
- *"What's the feasibility of doing all four? What's good quality? If all four, tag which pipeline it came from."* → Established that the three signals are **vertical-agnostic in mechanism**, so "all four" doesn't multiply the engineering — only the content curation. **Produced a locked requirement:** every lead is tagged by **vertical** AND by **signal source**.
- *"What would reasonably change about the briefs per vertical?"* → Established the **Vertical Pack** architecture: one shared engine + brief frame, plus a small per-vertical tuning pack. (Variables catalogued below.)
**Decided:** **All four verticals, equal depth — author 4 full Vertical Packs** (Dermatology · Women's Health / OB-GYN · Ophthalmology · Orthopedics). Fullest breadth; mirrors EliseAI's real multi-vertical strategy; strongest "it generalizes" story. Accepts ~4× curation and 4× real proof points to source & verify.
**Locked regardless of coverage:** every lead in the feed carries a **vertical tag** + a **signal-source tag** (which pipeline surfaced it) — feeds the CRM-tracking requirement (#1).

### D7 — The brief card contents  ✅
**Q:** Beyond the D1 spine, what else goes on the brief card?
**★ Research (done):** benchmarked our card against top-AE prep. Verdict — **~80% aligned; nothing wrong.** Found 3 must-have adds; confirmed all 3 held candidates.
*Sources:* [Gong call-prep checklist](https://www.gong.io/files/gong-guide-sales-call-prep-checklist.pdf) · [30MPC exec-brief checklist](https://www.30mpc.com/newsletter/checklist-to-brief-your-execs-before-sales-calls) · [Josh Braun (personalization)](https://www.linkedin.com/posts/josh-braun_are-you-over-personalizing-cold-emails-activity-6713765640844517376-X7VF) · [LeadIQ 4T framework](https://leadiq.com/blog/writing-a-great-cold-email-with-the-4t-template).
**Must-have adds (from research):** incumbent tooling (current front-desk / phone / scheduling tool, not just EHR) · 2–3 discovery questions · a named next-step CTA for the sequence.
**Held candidates — all confirmed YES:** objections + rebuttals · prospect-facing ROI **range** (defensible, not false-precise) · per-signal confidence + **freshness** (freshness ≈ must-have — a stale trigger kills the "why now").

**Final card — two tiers (protects glanceable + ready-to-use):**

*⚡ At-a-glance (top):*
- **Buying-moment headline** + **signal count** ("3 signals firing," listing each fired signal) + **freshness** badge
- **Who to contact** — name, role (practice manager / administrator / owner), best channel + a unique personalization snippet
- **Recommended action** — call opener + a 3-touch outreach sequence (initial + 2 follow-ups) → a **named next-step CTA**; the sequence is **directly editable inline** in the dashboard

*📋 Call prep (expand):*
- Practice profile (locations, EHR, patient-volume, front-desk load) + **incumbent tooling**
- EliseAI-fit / pain + proof point + **ROI range**
- **2–3 discovery questions**
- **Top 3 objections + rebuttals**
- **Confidence** badge per signal · every claim source-linked · vertical + signal-source tags

**Nice-to-haves — resolved:**
- **Mutual connections → ✅ solved via deep-link (not a scrape).** We don't *fetch* mutual connections (that needs LinkedIn auth). Instead the *who-to-contact* card shows a **"Check for mutual connections"** prompt with a **LinkedIn button** (deep-links to the contact's profile, where LinkedIn surfaces mutual connections right at the top) and a **Facebook button** — LinkedIn = the professional path, Facebook = the personal one. The AE clicks and eyeballs it in a second. Clean, ToS-safe, and it turns a benched feature into a real one.
- **Peer / competitor proof → 🪑 future integration.** Pull real proof **from EliseAI's customer-success metrics** ("a clinic like yours nearby cut cost-per-call 66%") to infuse verified proof into the pitch — an internal-data integration, not a scrape. (Relates to benched signal #8.)

### D8 — Feed prioritization (refines D5)  ✅
**Decided:** the push feed **ranks leads by signal count** — a practice with 3 fired signals outranks one with 1, so the AE works the hottest accounts first. Signal count shows on the headline (D7) and drives the dashboard's default sort order.

### D9 — Data: real, not fabricated  ✅
**Q:** What populates the demo — seeded/fake fixtures or real data?
**Decided:** **Real data, sourced live while building & testing.** Fake data proves nothing; real practices with real public signals *are* the proof. "Demo-mode" refers to actions, not data.
- **Input = 100% real** — the engine actually pulls real practices + real public signals (Indeed posts, Google/Yelp/Healthgrades reviews, deal news). The build ships real working detectors, not fixtures.
- **Contacts = real & named** — the actual decision-maker (name + role from public LinkedIn) and the real personalization snippet. It's public professional info; maximally credible. *(Can flip to role-only for any context that needs it, but default is named.)*
- **Actions = simulated (what "demo-mode" means here)** — drafts + displays only; **nothing sends, nothing writes to EliseAI's live systems, we never contact the practices.**
- **Zero patient data / PHI, ever** — only public *business* signals + *business* contacts. Never a patient.
- **Clean sourcing** — official APIs / ToS-respecting methods where possible, so "real" is also defensible.

### D10 — ROI scoreboard: leading vs. lagging (the metric architecture)  ✅
**The guiding question — kept deliberately, because it's the thinking behind the architecture:**
> *"What is the ultimate goal of this system? (1) generate more revenue, (2) decrease client-acquisition cost — the two primary goals of any business. So what **leading** metrics would signal those **lagging** metrics?"*

**Verified — "more revenue" & "lower CAC" are both LAGGING (outcome) indicators.** Revenue is a pure lagging outcome; CAC is a lagging period-ratio (spend ÷ new customers). *Nuance:* leading/lagging is relative to what you're predicting — CAC itself can act as a *leading* indicator of downstream unit economics (LTV:CAC, payback period).

**The deciding filter (your principle):** *track a metric only because it drives an optimized action — anything else is noise.* So every metric is tied to the learning loop it powers.

**Resolved:**
- **Timing-vs-cold → not a live tile; it's the validation *test*** (buying-moment vs. cold/demographic list → meetings + deals). The tool is *built* to run it, presented as the experiment that proves the bet — never an assumed hero number.
- **Cost-per-meeting** tracked fully · **sales-cycle velocity** kept (also = automation time-saved) · **touches-to-meeting** kept.
- Every metric viewable **aggregate + per-vertical.**
- **AE lead-quality feedback:** 👍 good / 👎 not + optional one-tap reason + optional **free-text "why"** — qualitative + quantitative together = a much stronger research / lead-sourcing loop.
- **Voice:** plain, 8th-grade — an AE gets every number at a glance.
- **Honesty tag:** each number is **measured** (real from the tool) or **modeled** (projected from public benchmarks); modeled → measured in production.

**Full plain-voice spec (the metric → loop chart) lives in Requirements → "3. ROI Tracking".**

### D11 — CRM / stack integration depth  ✅
**Q:** Which tools does this workflow integrate with, how deep, and what gets tagged/tracked? *(Refines Requirements #1.)*
**The integration map — build only what the workflow needs:**
- **CRM = the hub → build (real).** Push tool-sourced leads; **tag** vertical · signal-source · signal-count · 👍/👎 quality; **track** meetings → deals → cycle time. *(This is what makes the ROI "measured" numbers real.)*
- **Clay = enrichment → sit on top.** Pull enrichment from Clay; don't rebuild it (the whitespace thesis).
- **Outreach = send-handoff → built & dev-tested, key-gated.** The tool *can* send the approved sequence via Outreach the moment EliseAI adds their Outreach API keys — the send path is built and tested in our dev process, switched OFF for the demo (no keys). Real and ready, not a stub.
- **Gong / Attention → 🪑 future integration (call-data → outreach).** Thesis: *the more sales-call data we feed into the outreach strategy, the more effective the system gets.* Pipeline: pull call recordings (Gong / Attention) → analyze → embed the insights into the brief + the outreach drafts. Documented now, built later.
- **Zapier → skip** — build custom connectors (your lean).
**Integration depth (decided):** **real integration to a free CRM instance** — genuinely push + tag + track; demo-safe, matches "real > fake" (D9), and proves the integration actually works.
**CRM pick:** **HubSpot-free for the demo build** (fastest real integration, clean API). The tool stays **CRM-agnostic by design**, so it maps to EliseAI's real CRM (likely Salesforce) in production. *(Flip to a Salesforce dev org if we'd rather mirror their actual stack — say the word.)*

### D12 — Scope guardrails  ✅
**✅ IN — the demo builds:**
- Push feed of **real** practices at a buying moment, ranked by signal count (pull / paste-a-name secondary)
- The **3 built signals** only (front-desk spike · phone-complaint reviews · growth events)
- Two-tier brief card across **all 4 verticals** (4 vertical packs), **real named contacts**
- Editable **3-touch sequence** (drafts)
- **Real CRM integration** (HubSpot-free) — tag + track
- **ROI Tracking** scoreboard + AE 👍/👎 (+ free-text "why") feedback
- **EliseAI branding**
- **Send-via-Outreach — built & dev-tested, key-gated.** Ready to fire the moment EliseAI adds their Outreach keys; OFF for the demo (no keys). Real path, not a stub.

**🚫 OUT — not in the demo:**
- **Actually contacting real practices / any live send firing**, and **writing to EliseAI's live systems** — the demo runs without keys, so the send path stays gated (built, but off — see IN).
- **Any patient data / PHI** — public business signals only.
- Non-built signals: regulation (research-gated), creative 5–8 (future), bench 9–12.
- **Peer-proof** (future CS-metrics integration) · **Gong / Attention call-data pipeline** (future — see D11). *(Mutual connections moved to IN — solved via LinkedIn / Facebook deep-link buttons; see D7.)*
- **Zapier** (custom connectors instead).
- **Timing-vs-cold as a live metric** — it's the offered *validation test*, not a built dashboard tile.

**⚠️ Directions for AI coding agents (scope discipline):** if you are about to build something **beyond this requirements spec**, STOP — revisit the requirements and **justify to the user WHY it needs to be built** before proceeding. Do not silently expand scope.

### D13 — Data layer: SQL + immaculate data-engineering  ✅
**Decided:** the build stands on a **SQL database (Postgres)** as its system of record, built to strict data-engineering standards — normalized schema, provenance on every fact, idempotent de-duped ingestion, raw-vs-derived separation, audit trail, first-class tags, ingest validation, business-data-only. *This is what makes the source-linked briefs (D2), freshness (D7), and aggregate/per-vertical ROI views (D10) real rather than cosmetic.* Full spec → **Requirements #4.**

### D14 — Onboarding & rollout model  ✅  *(decided 2026-07-07, after D1–D13 locked)*
**Q:** How does a non-technical AE start using this — given the builder does not have access to EliseAI's own systems, so someone at EliseAI must connect the integrations?
**Decided — "Full value before a single key":** the whole tool runs on the builder's own infra with real enriched leads, so viewing / enriching / editing / feedback / scoreboard all work with zero EliseAI access. Only the two *write-to-their-systems* actions need EliseAI's own credentials — **live send + CRM tracking, both = the one HubSpot connection** (§ Stack); the connect model is **OAuth (HubSpot) + BYOK keys (Anthropic, PDL)**. The Send button is a **named, routed handoff** to the RevOps key-owner: "the RevOps owner connects HubSpot — ~5 min, once," with **[Send it to the RevOps owner]** / **[I have access → steps]**, and each rep's tap **aggregates** into visible demand. **Rollout = whole team at once, demand-driven** — AE pull pressures RevOps to connect (the users pull it in). **Three archetypes:** Viewer (zero setup) · AE (zero setup) · Admin/RevOps (the only setup — a mixed OAuth + BYOK-key "Connections" checklist). **Language = 8th-grade, one thing at a time, only the words needed.** *Granular flows, copy, per-archetype journeys, and the guided-step UI direction live in the design doc, not here.*

### D15 — Scheduled trigger: one heartbeat, Vercel Cron (not Inngest)  ✅  *(decided 2026-07-10)*
**Q:** What fires the engine on a schedule so the feed is a **constant flow** (R1) with no human trigger — and what runs that schedule?
**The architecture (locked):** **ONE run trigger fires ALL signal sources at once** (Adzuna staffing · Google Places phone-complaints · GDELT growth · the rotated-metro discovery scan — and, in future, any org-connected data signal), and that **cascades downstream** (fresh leads → enrich → cited brief → feed). Not a separate schedule per source — a single heartbeat for the whole engine.
**Options weighed (the runner):** Inngest *(the original pick)* · **Vercel Cron** · Supabase Cron (pg_cron).
**Decided:** **Vercel Cron.** The engine is TS + npm (Drizzle, Anthropic SDK, cost meter), so the job **runs on Vercel no matter what** — the only question is which doorbell rings it. Vercel Cron is the doorbell on the same platform the code already lives on: **zero new vendor, account, or served endpoint**, defined declaratively in `vercel.json`, free at our cadence, fail-closed via `CRON_SECRET`.
- **Why not Inngest:** it's a durable step-function/queue platform — fan-out, retries, replay — none of which two time-triggered HTTP jobs use; it costs a separate vendor + two keys + an app registration + a served endpoint for machinery we don't exercise. (Its wrappers were also *never actually served* — nothing fired.)
- **Why not Supabase Cron:** genuinely free with no once-a-day cap, but to run our code it can only HTTP-ping a Vercel route (so we'd build that route anyway) — kept as the documented **free fallback** if we ever need sub-daily cadence for free.
**Cadence:** **business days only (Mon–Fri), 08:00 UTC** (`vercel.json` → `0 8 * * 1-5`) — reps don't work leads on weekends, so a fresh batch waits each workday morning and no spend fires Sat–Sun; still ≤ once/day so it stays free on Vercel's Hobby tier. Idempotency (already-briefed practices skip free; 90-day re-pull cache) means this pace isn't materially costlier than weekly, it just fills the feed faster. A one-line change; every-day/weekly documented as alternatives.
**Reliability comes from the JOB, not the trigger** (neither free scheduler retries/alerts): idempotent + reconciliation-based + bounded per run (`ENGINE_BRIEF_LIMIT`) so a missed/partial run self-heals next tick; the run is metered (R19) and returns a structured summary. **Nothing sends (D9).**
**Full sourced comparison + flip-on runbook:** completed during the D15 build.

### Signal Catalog

| # | Signal | Kind | Public data source | Why it predicts a buy | Status |
|---|--------|------|--------------------|----------------------|--------|
| 1 | Front-desk staffing spike | Hiring | Indeed / LinkedIn posts ("patient coordinator," "front desk," "call center") | They can't staff the phones — EliseAI's exact wedge | ✅ Build |
| 2 | Phone-complaint reviews | Voice-of-customer | Google / Yelp / Healthgrades reviews ("can't get through," "on hold") | Acute, self-reported phone pain | ✅ Build |
| 3 | Growth events | Expansion | PE deal news, site changes, Google Business, new provider bios | New volume outstrips the front desk; consolidation → tooling standardization | ✅ Build |
| 4 | Regulation deadline | Compliance | CMS / payer prior-auth & interoperability rules with dates | A dated rule forces a buying moment (EliseAI handles prior auth) | 🟡 Research-gated |
| 5 | New ops leadership | People | LinkedIn job-changes, practice announcements | New decision-maker in first 90 days = buying window | 🪑 Future potential |
| 6 | Long "next available" | Capacity | Booking widget / Zocdoc / Healthgrades | Schedule overwhelmed → scheduling + waitlist pitch | 🪑 Future potential |
| 7 | Patient-access tech gap | Intent | BuiltWith / Wappalyzer | Just added (in-market) or lacks (greenfield) online scheduling / portal | 🪑 Future potential |
| 8 | Peer adoption / FOMO | Social proof | Competitor case studies, press | Same-specialty, same-metro practice adopted AI patient comms | 🪑 Future potential |
| 9 | Job-post text mining | Hiring (refines #1) | Job-post body text | Pain named in the listing ("reduce no-shows," "high call volume") | 🪑 Bench |
| 10 | Staff reviews | People (corroborates) | Glassdoor / Indeed employee reviews | "Understaffed," "phones never stop" — internal corroboration | 🪑 Bench |
| 11 | New service line | Expansion (refines #3) | Practice site / announcements | New appointment complexity (e.g., derm adds a MedSpa) | 🪑 Bench |
| 12 | AE-submitted signal | Extensibility | Your own reps (manual input box → later, AI mines sales scripts) | Reps discover new buying-moment signals on live calls; capture them (see your **# Ideas** note below) | 🪑 Bench |

### Vertical Pack — the per-vertical brief variables *(author 4×: Dermatology · Women's Health/OB-GYN · Ophthalmology · Orthopedics)*

Everything in the engine + brief frame stays identical across verticals. **These five variables are the only things that change per vertical** — a "vertical pack" is one authored set of them. A vertical = a different pitch, not a different product.

| Variable | What changes | Example (Dermatology) |
|----------|--------------|------------------------|
| **Pain + EliseAI-fit line** | The sharpest version of the front-desk / phone pain for this specialty | "High call volume split across cosmetic + medical, spikes at skin-check season, front desk underwater" |
| **Opener language & tone** | Vocabulary + what the opener leads with | "Most derm groups your size are losing the phone battle around screening season…" |
| **Proof point** | One real, citable EliseAI case study in this vertical | Georgia Dermatology (88% of calls handled, 3+ hrs/day saved) |
| **EHR-as-signal** | Which EHR(s) flag this vertical | ModMed / Nextech |
| **ROI benchmark** | Specialty call-volume / no-show rate / appointment value feeding the ROI number | *(derma benchmark — TBD)* |

**Shared (NOT per-vertical):** the 3 built signals + their detection, the brief layout, the citation/verification mechanism, the vertical + signal-source tags, and the ROI logic.

**Proof-point sourcing status** (D2's "cited claims" raises the bar — each must be real & citable):
- **Dermatology** ✅ — Georgia Dermatology, Kansas City Skin & Cancer Center, Texas Dermatology, Dermatology Partners.
- **Women's Health / OB-GYN** ✅ — Women's Health Connecticut (52% fewer inbound calls), Women's Excellence.
- **Ophthalmology** ~ — Grin Eye Care; confirm a hard metric.
- **Orthopedics** ⚠️ — no named EliseAI case study surfaced yet → **research TODO** before this pack is demo-ready.

### Open questions — none 🎉
*Every decision point D1–D15 is closed. (D14 — onboarding & rollout — was added 2026-07-07 after the initial D1–D13 lock. D15 — scheduled trigger — was added 2026-07-10: one Vercel-Cron heartbeat fires the whole engine, superseding the original Inngest pick.) What's left is the build, not more decisions.*

---

## Requirements

1. Integrate with software in their stack (ie. CRM)
	- Salesforce, HubSpot, Outreach, Zapier, Clay, Gong, Attention ** note-i lean 	custom over zapier. 
	- Do not need to connect to all of them, just the ones that matter & make s	ense for this workflow (ie. If its finding leads, then those leads should be 	tagged & tracked in the CRM to track the client acquisition journey).

2. **Match EliseAI's branding / design system.** The tool should look like it belongs to EliseAI — pull the design system (colors, type, components, UI voice) from their live site.
	- Reference pages: https://eliseai.com/platform-overview · https://eliseai.com/elise-beyond?hsCtaAttrib=215260706383
	- **Do NOT pull now** — this is a plan/build-time task. The **planner** pulls the design system from these pages during the build phase; here we only document the requirement + the source URLs.

3. **ROI Tracking** — a scoreboard baked into the tool, scoped to *this tool's own impact* (not a generic company dashboard). Written plain by design — an 8th-grader gets every number at a glance. **Deciding rule:** track a number only because it drives an action; anything else is noise — so every metric is tied to the loop it powers.

**The two end goals** *(lagging):*
- Are we closing more deals? *(revenue)*
- Does each new customer cost less to win? *(CAC)*

**The loops:** 🔧 Loop 1 = smarter tool (improves this build) · 📈 Loop 2 = smarter GTM (improves EliseAI's whole sales engine)

**Every early sign, tied to the loop it powers** *(all viewable aggregate + per-vertical):*

| The question it answers | Powers | The move it drives |
|---|---|---|
| Which buying signals turn into meetings? | 🔧 + 📈 | Keep/kill signals & re-rank the feed *(tool)* · aim the team at the buying moments that pay off *(GTM)* |
| Which specialties win fastest & cheapest? | 🔧 + 📈 | Sharpen each specialty's pitch *(tool)* · send the new team to the best specialties first *(GTM)* |
| Did the AE mark it 👍 or 👎? | 🔧 | Learn what a good lead looks like → find more, waste less |
| How many messages to land one meeting? | 🔧 | Fix the sequences that aren't landing |
| How many meetings did the tool get us? | 📈 | Prove the tool's pulling weight → expand it |
| What does each booked meeting cost? | 📈 | Put budget where meetings are cheapest |
| Are deals closing faster? | 📈 | Show timing shortens the cycle → back the approach *(also = time saved)* |
| Time saved + good practices found this week? | 📈 | Free reps to sell more → roll it out wider |
| **The big test:** buying-moment vs. cold list | 📈 | Decide whether to bet bigger on timing-based sourcing |

**AE lead-quality feedback (powers 🔧 the research loop):** the AE marks each lead **👍 good / 👎 not**, with an optional **one-tap reason** (too small · wrong specialty · already a customer · bad timing) and an optional **free-text "why."** The qualitative note + the quantitative conversion data together make lead-sourcing much stronger.

**The big test (not a live tile):** the tool is built to run buying-moment vs. cold/demographic sourcing head-to-head (meetings booked + deals landed) — presented as the experiment that proves signal-based sourcing beats the status quo.

4. **Data layer — a SQL database, built to immaculate data-engineering standards.** A relational database (Postgres) is the system of record for every practice, signal, contact, brief, outreach, feedback mark, and ROI event. It's what makes the aggregate + per-vertical views (Req #3) and the source-linked "cited claims" (D2) actually work — not cosmetic.

	**Immaculate data-engineering principles (non-negotiable):**
	- **One source of truth, normalized** — clean relational schema, typed columns, real primary/foreign keys; no data duplicated across tables.
	- **Provenance on every fact** — each signal/claim stores its **source URL + the timestamp it was detected**, so the brief's source-links (D2) and freshness badges (D7) are backed by real lineage.
	- **Idempotent ingestion** — upserts that de-dupe practices, signals, and contacts; **never blindly overwrite a real record** (check-existence / `ON CONFLICT DO NOTHING`).
	- **Raw vs. derived kept separate** — raw scraped signals → normalized entities → derived scores (signal count, conversion); every number traces back to its inputs.
	- **Timestamps + audit trail everywhere** (created / updated / detected); schema changes run through tracked migrations.
	- **Tags are first-class columns** (vertical · signal-source · lead-quality) so every metric slices by vertical instantly.
	- **Validation on ingest** — flag/reject malformed or unverifiable rows rather than letting dirty data in.
	- **Business data only — no PII / PHI** beyond public business contacts (D9). 



---



# Stack — LOCKED (2026-07-07)

*The concrete build stack, decided across the requirements interview. **Ownership model:** this is an internal tool EliseAI operates on **their** keys and systems (bring-your-own-key + connect); the demo runs pre-configured on the builder's keys ("full value before a single key"). Only Supabase is app-managed. Because it's an **internal** tool (not a distributed product), OAuth apps run in internal/unverified mode — no marketplace listing or security-review walls. **This section supersedes the tool-specific choices in D11** (Clay, Outreach-primary, HubSpot-private-token) where they differ; the D11 *rationale* still holds.*

| Layer | Choice | How the customer supplies it | Status |
|---|---|---|---|
| Data (system of record) | **Supabase** Postgres + Drizzle | App-managed; RLS-locked, server-only access | ✅ locked |
| Research + brief synthesis | **Anthropic Claude** — Opus 4.8 (brief voice) · Sonnet 5 / Haiku 4.5 (agentic research + extraction) | BYOK — paste API key | ✅ locked |
| Enrichment (company + person data) | **People Data Labs (PDL)** | BYOK — paste API key; sync request/response API | ✅ locked |
| CRM (push · tag · track) | **HubSpot** | OAuth "Connect" | ✅ locked |
| Email send (editable 3-touch) | **HubSpot** (Sequences via the whole-body-token trick) | OAuth "Connect" | ✅ locked |
| Email analytics (open/click/reply · A-B) | **HubSpot** native (rides the send) | — (same connection) | ✅ locked |
| Scheduled trigger (the engine heartbeat) | **Vercel Cron** — one weekday (Mon–Fri) run fires all signal sources → cascade (not Inngest; Supabase Cron = free fallback) | App-managed; one `CRON_SECRET` (fail-closed) | ✅ locked (D15) |

**Send mechanism (locked):** the AE edits the AI-drafted email in the dashboard → the full body is written into ONE HubSpot custom contact property → the contact is enrolled into a HubSpot Sequence whose template is a single `{{custom_body}}` token → it sends **through the rep's connected inbox**, so HubSpot's native open/click/reply tracking + CRM logging come free while the exact edited body still ships. Emails are **plain-text** (best for 1:1 sales; de-risks the single-token fidelity). The **app owns the 3-touch cadence** (light throttling + reply-detection). Outreach is **not required** — kept as an optional future adapter for orgs that mandate a sales-engagement platform. *(Deliverability is the rep's own mailbox either way — a SEP wouldn't raise Gmail's ~2,000/day ceiling; this tool is low-volume/high-personalization by design.)*

**Enrichment mechanism (locked) — the waterfall:**
- **Claude (agentic web research) does the bulk + the part PDL can't.** It reads the practice's real site/staff page for firmographics, EHR, and the decision-maker's name/role — **every fact cited to its source (D2)** — AND discovers the **buying-moment signals** (the timing intel PDL has *no data for*; this signal discovery is the tool's core differentiation, not just demographics). Claude is the flexible research layer precisely because we need moments + nuance, not a static demographic pull.
- **PDL fills the verified gaps:** the structured contact data Claude can't reliably get — **verified work email + LinkedIn URL** — at a fraction of a cent to a few cents per matched record; PDL is the raw data layer this tool sits on top of.
- **Apollo — benched.** Apollo bundles a point-and-click UI + sequencing this tool *replaces*; its API is available on free/trial (credit-limited) so it's usable to spot-check, but for THIS engine PDL's usage-priced, developer-first API is the cost-efficient layer (PDL: 1.5B+ profiles, per-record pricing; Apollo: ~220–250M contacts, seat/UI-priced). If EliseAI's team already lives in Apollo's UI for other reasons, it complements — it does not replace PDL here.

**Integration method per tool (OAuth vs API key — the explicit map):**

| Tool | Auth mechanism | Integration surface | Nuance |
|---|---|---|---|
| **HubSpot** | **OAuth 2.0** (authorization-code; internal/unverified app — no marketplace review) | REST API — CRM objects (companies/contacts/deals) · Sequences enrollment (`POST /automation/sequences/{v}/enrollments`, scope `automation.sequences.enrollments.write`) · webhooks for open/click/reply events | Access token ~30 min → refresh proactively off `expires_in`; refresh token long-lived until revoke. **One "Connect HubSpot" grant covers CRM + send + analytics.** |
| **People Data Labs** | **API key** (BYOK) — sent as request header | **REST API, synchronous** request/response — Person Enrichment + Company Enrichment | No OAuth exists (developer-first DaaS). Customer pastes their key in settings → encrypted at rest, per-tenant. |
| **Anthropic (Claude)** | **API key** (BYOK) — `x-api-key` header | **Messages API** (REST) + server-side **web-search / web-fetch** tools for the agentic research loop | No third-party spend-delegation OAuth exists (category-wide). Key pasted → encrypted. Bills to the customer's account → measured CAC. |
| **Supabase** | **App-managed** (not a customer connect) | Direct **Postgres** connection via Drizzle (session pooler) for data; **Supabase Auth** (email allowlist) for app login | Provisioned as part of the deploy; RLS-locked, server-only access. |

*(Outreach, if ever activated as the optional send adapter: **OAuth 2.0** only — no static keys — with token-exchange + refresh; gated OFF until credentials exist.)*

**Connect-vs-BYOK (the onboarding surface):**
- **OAuth "Connect":** HubSpot (CRM + send). Internal-app mode → no review/listing.
- **BYOK key-paste:** Anthropic · PDL. *(No LLM or enrichment provider offers real spend-delegation OAuth — that's the category, not a limitation. On the customer's keys, spend bills to **them** and shows up as **measured** cost in the CAC scoreboard.)*
- **App-managed:** Supabase.

**Why these choices — the rationale (the judgment layer; this is what the build demonstrates):**

- **HubSpot for CRM + send + analytics.** The CRM is the hub, and HubSpot's free tier + $0 developer accounts + instant OAuth make it the *only* send/CRM path fully **demoable at $0** (Outreach's API is Enterprise-gated behind a sales call). Folding send onto the *same* OAuth grant means **one connection** does CRM + sending + open/click/reply analytics — unified pipeline data for the ROI scoreboard, one system to stitch instead of two. Sends go through the rep's own inbox (best deliverability), and the whole-body-token trick ships the AE's *exact* edited email while keeping native tracking. A real "Connect your CRM" OAuth flow is also the strongest proof of *"integrate with their stack."*
- **PDL for verified contact data.** Developer-first data API (no UI), usage-priced at cents/matched-record → scales cheaply and lets the tool sit *on* the raw data layer instead of paying for a point-and-click UI on top. Its license is built for *"store + display in your own app"* (Apollo's is internal-use-only — a real wall for a product-shaped tool). 1.5B+ profiles → the broadest coverage for the verified email + LinkedIn URL Claude can't reliably get.
- **Claude as the research + signal layer — the actual differentiator.** Data vendors return *demographics*; this tool's whole thesis is *timing* — the buying-moment signals — which **no static data vendor has data for**. Only an adaptive LLM research layer finds them. Claude also reads a small clinic's real staff page (where PDL's DB thins out) and **cites every fact to its source (D2)** — a stronger trust story than a black-box vendor — and one BYOK key powers both the research *and* the brief voice.
- **Supabase for data.** A proven, high-velocity stack; Postgres is exactly the SQL required and the D13 immaculate-data-engineering system of record; RLS-lockable; ships a live URL day one.

**Cross-cutting decisions (the meta-why):**
- **OAuth only for their *systems*, BYOK-key for *infrastructure*.** OAuth fits the customer's connected systems (CRM/send); the LLM + enrichment are infrastructure they *provide a key for* — because **no LLM or enrichment vendor offers spend-delegation OAuth** (verified across Anthropic/PDL/Apollo). That's the *category*, not a limitation — and on their keys, the spend becomes **measured** CAC in the scoreboard.
- **Internal tool, not a distributed product.** EliseAI runs it on *their* keys/systems, so OAuth apps run internal/unverified — no marketplace listing or security-review walls. This *inverts* the usual product-distribution friction: "runs on their keys" is the *easy* path, not the hard one.
- **Direct custom send, not a sequence platform.** Both HubSpot and Outreach sequence APIs are template-only (no free-text-body param); the whole-body-token trick routes around that so the AE ships the *exact* edited email while still getting the platform's native tracking — best of both.
- **Waterfall enrichment (Claude-first → PDL-gap-fill).** Cheaper (PDL is hit only for the verified gaps, not every record → stays in a low tier longer), better coverage (Claude catches SMB staff pages PDL misses), and on-thesis (cited). The standard "data waterfall" pattern, sized by validation experiment #1.

**Dropped this session (with reasons):**
- **Clay** → no OAuth, webhook/HTTP-API gated to ~$446/mo Growth tier, async (minutes). Replaced by PDL (sync, usage-priced, self-serve).
- **Apify** → not needed; signal detection sources from official APIs (Google Places / Yelp) + free GDELT news; enrichment is PDL's job.
- **Outreach (as the required send tool)** → its sequence API is template-only (same shape as HubSpot) and API access is Enterprise-gated behind a sales conversation; HubSpot covers send on a $0 developer account. Outreach stays an **optional adapter**.
- **Apollo (as primary enrichment)** → benched; PDL is the cost-efficient raw-data layer and this tool replaces the point-and-click UI Apollo charges for.

**The pitch angle (documented):** this is a *custom, optimized* signal + enrichment engine built directly on the raw data layer (PDL). Once the data structure EliseAI typically pulls is nailed down, they can **cut the UI-tool markup** (the point-and-click layer Apollo/Clay sell on top of the same underlying data) and own a leaner, cheaper, **signal-aware** pipeline — retrieving not just demographics but the buying-moment signals a static data vendor can't.

## Stack-validation experiments (run once, during the build)

*Each stack choice carries a cheap validation to run during U5 / U6 / U15 — so the stack is proven, not assumed.*

1. **Enrichment: Claude (Sonnet 5) vs PDL — for company data AND person data.** Run ~20 real small practices through both. Measure **per-record cost + hit-rate** for (a) company firmographics/EHR and (b) the decision-maker's name/role/email/LinkedIn. **Decides the exact waterfall split** — what Claude retrieves vs. what PDL fills — and whether we need the Anthropic layer for the *demographic* part or only for signals. *(Anthropic is already assumed essential for buying-moment signal discovery — PDL has no data there; this experiment sizes its role in demographics.)* Cost anchors on file: PDL ~$0.28/record self-serve (→ cents at Enterprise); Claude-agentic ~$0.10–0.15/practice on Haiku/Sonnet.
2. **HubSpot whole-body-token fidelity + limits.** Spike: does a full **plain-text** body injected via one `{{custom_body}}` personalization token render intact through a Sequence send? Confirm custom-property length + count (×3 touches).
3. **HubSpot $0 demo path.** Confirm Sequences + the enrollment API work on a **free developer test account**, on the same OAuth grant as the CRM push.
4. **Small-practice enrichment coverage** — the real risk; folded into experiment #1. If both PDL and Claude thin out on 1–5-location clinics, note it honestly and widen metros rather than fake recency.
5. **Timing-vs-cold validation** (already spec'd — Requirement 3, "the big test"): the cohort experiment proving signal-based sourcing beats a cold/demographic list. The tool is built to run it; presented as the experiment that proves the thesis.

---

# Ideas to Evolve on this Build

- 'add a buying moment signal' input box in UI >>> 
	- v1 = sales AE drops in an insight manually after discovering a new buying 	moment signal from a sales call. 
	- v10= ai analyzes every sales script & integrates new buying moment signals 	(if trackable) into signal-based lead sourcing system

- **The MORE we integrate sales-call data into the outreach strategy, the more effective this system becomes.** Set up data pipelines from sales-call recordings (Gong or Attention) → analyze → embed into the brief + outreach drafts. *(Now captured as a future integration in D11.)*

- **Would be awesome, not essential — a profile picture of the lead on the 'who to contact' card**, to build empathy between the AE and the human they're calling.

- Here's a guide on how to adapt this repo to a proptech product. See [adapt-to-proptech.md](./adapt-to-proptech.md).
