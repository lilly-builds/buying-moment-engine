# Buying Moment — GTM Context (session capture, 2026-07-11)

**What this is:** a self-contained context dump so a fresh window can pick up the Buying Moment go-to-market work with nothing lost after compaction. This is CONTEXT only. Lilly will paste her own next-action prompt. Do not infer the task from this file; wait for her prompt.

**No em dashes anywhere. Plain English. This is a hard house rule (see Guardrails).**

---

## 1. The product

- **What it is:** a working engine that finds businesses hitting a buying moment from public signals, hands a rep a cited sales-call brief plus a customized multi-touch email sequence, pushes to HubSpot, and has an ROI scoreboard. Vertical-agnostic core; healthcare (EliseAI) is one "vertical pack."
- **Live:** buying-moment-maestro.vercel.app
- **Repo:** `/Users/love/Developer/buying-moment-engine` (sibling `bme-*` repos are worktrees/experiments; this is the main one).
- **Stack:** Next.js (modified, see the repo AGENTS.md warning about non-standard Next), Supabase Postgres + Drizzle, Anthropic Claude (Opus 4.8 for brief voice, Sonnet 5 / Haiku 4.5 for research/extraction), People Data Labs enrichment, HubSpot OAuth (CRM + send via the rep's inbox), Vercel Cron heartbeat (weekday 08:00 UTC fires the whole engine).
- **How it works:** reads messy public data with an LLM research layer plus enrichment, detects buying-moment signals, outputs a two-tier cited brief (every claim source-linked) plus an editable 3-touch email sequence, pushes/tags/tracks in HubSpot, shows an ROI scoreboard.
- **Signals already built:** front-desk/hiring staffing spike, phone-complaint reviews, growth events. Cost is roughly $0.05 to $0.30 per brief. The engine has a cost meter and per-run caps.
- **Full spec:** `~/Desktop/Personal Life/Career System/eliseai/eliseai-spec.md`

## 2. The website for the landing pages (critical, newly captured)

- **lillyfield.co lives at:** `/Users/love/Desktop/personal-brand`
- **Framework:** Next.js 16.2.2, React 19, Tailwind v4, TypeScript. App Router at `src/app/`. Assets in `public/`.
- **Deploy:** Vercel (`.vercel/` present). GitHub remote: `https://github.com/lilly-builds/personal-brand.git`.
- **To add landing pages:** new route folders under `src/app/` (e.g. `src/app/buying-moment/page.tsx`), assets in `public/`. Heed the repo's AGENTS.md ("this is NOT the Next.js you know", Next 16 has breaking changes, read `node_modules/next/dist/docs/` before writing code).
- **Env:** `.env.local` exists in that repo (do not print secrets).

## 3. The core thesis, and Lilly's latest correction to it

**The emergent pattern (buyer-agnostic, holds regardless of who we sell to):** a business changes state, that change is a buying window, and it leaves a public footprint the day it happens. Two flavors: the business is BUILDING (opened, grew, funded, rebranding) or HURTING (complaints, breach, its tool died). Nobody hands that footprint to the person who sells the fix. The whitespace is the reframe: take a public record built for buyer A and hand it to buyer B as a named, cited, ready-to-act lead. A filter cannot do that; a read-and-stitch engine can.

**The filter Lilly added (a passing criteria for any angle):** does it feel easy to sell and market, i.e. easy to explain? If a five-year-old does not get it in one line, it fails. This is why the highest-value-but-complex moments (Certificate of Need, legal filings) are out as the thesis: big money, but you would be teaching a niche buyer a complex thing.

**Lilly's correction to the buyer (2026-07-11, supersedes the earlier "local business" framing):**
- She REJECTS "sell to people who sell to local businesses." Reason: the more you sell to people who have money, the more money you make. People who sell to local businesses do not have much money, so that buyer caps our upside.
- She is CURIOUS about a techy, higher-value niche. Her example: **help B2B software companies find their leads** (our customer = B2B SaaS sales / growth teams). They have budget, high deal sizes, and run heavy outbound.
- Implication: go UP-MARKET on the buyer. Higher ACV also means fewer customers to reach ~$10k/month, which fits her "few high-value customers" goal.

**What the buyer pivot changes (for whoever picks this up):**
- If the buyer is B2B software sellers, the RELEVANT buying moments shift away from the local-business set (permits, reviews) toward B2B-software buying signals: new exec (VP/CMO/CTO), tech-stack change or churn, forced migration / vendor sunset, funding or new debt facility, going-concern language, hiring for a specific tool (they just bought it and need help), security breach, M&A integration, new-market entry. These come from the "digital/tech-stack" and "financial/corporate" research threads (see doc in section 5).
- Honest tension to hold: B2B software is the CROWDED arena (Clay, UserGems, Common Room, Warmly, Apollo all target exactly this buyer). The differentiation has to lean hard on three things: the finished cited brief plus ready email (the last mile nobody does at SMB price), the onboarding agent that auto-derives buying moments from the customer's own sales-call transcripts (appears genuinely novel), and the NON-OBVIOUS signals a filter misses (forced migration, going-concern, specific-tool hiring). Founder-fit is weaker here than the local angle (Lilly is an SMB-marketing founder, not a B2B-SaaS-sales insider), but B2B software is her native product context (EliseAI sold software to clinics) and adjacent to her sales work.
- The earlier "two spears" (the day they open / the day they break) were built for the local-business buyer. For a B2B-software buyer they recast to something like: the day they outgrow or lose their tool (forced migration), or the day a new decision-maker lands. Not locked. Direction for Lilly to steer.

**The one-sentence thesis, in its buyer-agnostic form (fill in the buyer):**
> "Tell us what you sell. We watch for the moment a company needs it, and hand you the company plus the pitch, already written."

## 4. Strategic decisions locked this session

- **Positioning:** lead with the OUTCOME ("reach them the moment they need you"), use timing/signals as the reason it works, not the headline. Own the words "Buying Moment." Domain buyingmoment.com is available. For the first experiments, Lilly wants the landing pages shipped as subpages of lillyfield.co, not buyingmoment.com. Trademark note: "Buying Moment" is descriptively weak and adjacent to Revenue.io's product "Moments"; run a USPTO search before investing in the brand.
- **Absorb the keys (the #1 anti-trap decision):** the customer NEVER pastes an API key. Lilly runs one Anthropic account and one enrichment account, marks up the cost, caps usage per tier. Setup is one sitting. Her past SaaS attempts died from setup complexity, so this is non-negotiable.
- **True self-serve SaaS, NOT concierge.** She has done the unscalable path and is done with it. Validate by watching real users self-onboard with ZERO hand-holding, small numbers first, before scaling spend.
- **The wedge:** an AI onboarding agent that derives the customer's buying moments from a 5-minute chat OR from their past sales-call transcripts. This appears novel as an assembled product (Gong reads transcripts but is enterprise and still needs a human to define the ICP; Perspective AI does conversational intake but has no signal engine). It is the moat, the activation moment, and the demo in one, because it deletes the human who normally defines "what is a buying moment for me."
- **Pricing shape:** flat monthly tiers, each with an included bundle of "briefs" in plain language (never tokens or credits). A brief = one company at a buying moment plus the decision-maker plus a cited why-now plus a ready email. Open with a reverse trial (first 3 briefs free, no credit card) and a free top-of-funnel tool. Example tiers to tune per niche: Free/reverse-trial $0 (3 now, then 3/month), a low tier ~$99, a money tier ~$299, an agency/team tier ~$599, top-ups ~$1/brief. Roughly 25 to 35 customers reaches ~$10k/month at ~80% margin. (For a B2B-software buyer, prices likely go higher; the incumbents there charge $700 to $2,750+/month.)
- **GTM channels ranked (for a solo founder who wants it to sell itself):** 1) programmatic SEO plus one free "grader"-style tool, 2) drink your own champagne (point the engine at its own market so outreach doubles as the demo), 3) founder content in communities, 4) a free Chrome extension, 5) one Product Hunt launch, 6) HubSpot App Marketplace later. Stay SMB and self-serve on purpose.
- **Hormozi grand-slam offer:** dream outcome + believability (every claim cited to its public source) + speed (first brief in minutes) + effort knockout (no key, no research, no writing; it derives your moments for you). Guarantee: "Find 3 real buying moments in your first week or you do not pay," plus a 14-day money-back and they keep the briefs. The reverse trial is itself the risk reversal.
- **Recruiting niche was explored and REJECTED:** the hiring signal is public and commoditized (LinkedIn Recruiter and every ATS already show "companies hiring X"), and it is not Lilly's world. It also wasted the engine's real strength (non-obvious signals). This rejection is what led to the "where are the unserved moments" research and the reframe pattern.

## 5. The research (two full docs in this repo, plus the highlights)

Two complete, cited documents already written this session:
- `docs/gtm-strategy.md` — full positioning, packaging, pricing, unit economics, GTM, and the grand-slam offer, with 43 sources.
- `docs/ideation/buying-moments-landscape.md` — about 80 candidate buying moments across 6 domains (regulatory, financial, physical, reputation, digital, sector feeds), critiqued and ranked, with the reframe meta-pattern, a Tier 1 (founder-fit) list, a Tier 2 (deep-moat) list, a rejected/commodity list, and sources.

Highlights a fresh window should not have to re-derive:
- **Competitor and price anchors:** Apollo $49 to $119/seat, Koala ~$350, Clay $149 to $495, Warmly from $700, Common Room ~$2,100, UserGems $2,750+. The whitespace: a finished cited brief plus ready email, at a small price, with zero setup, for non-tech verticals. Nobody serves that combination. The tools that do the brief (UserGems, Common Room) cost $25k to $120k/year and target funded software buyers.
- **A million-purchase study (bloomberry):** funding rounds (~25% lift), new-exec hires (~28%), job-post spikes (~7%) are both the most commoditized and only middling predictors. The edge is packaging the non-obvious, not a better feed of the obvious.
- **Self-serve reality:** time-to-value is the killer (activate within 24h converts 2x; un-activated trials 2 to 8% vs activated 35 to 65%). Reverse trials convert ~24% median and are under-used. Absorb the keys, pre-fill the workspace, and make the derived ICP one-click editable.
- **The reframe pattern (the core insight):** a public record built for buyer A, handed to buyer B as a named cited lead. Examples: permit data (sold to contractors), breach lists (mined by security vendors), import records (supplier research), review tools (inward-facing only). The read-and-stitch engine is the only thing that turns those into a targeted brief.
- **Buying moments most relevant if the buyer = B2B software sellers** (from the digital and financial threads): forced migration / vendor sunset (a tool with a dated death sentence plus who still runs it), going-concern or material-weakness language buried in filings, a company hiring for a specific platform (bought it, needs help), tech-stack churn (a tag disappeared), new debt/credit facility, PE bolt-on acquisition, new CMO/CTO via 8-K Item 5.02, security breach. These are the non-obvious, less-served signals for that buyer.

## 6. Lilly's preferences and guardrails (non-negotiable)

- **No em dashes anywhere** in any copy, ever. The single biggest AI tell. Scrub proactively.
- Plain conversational English, no techy jargon unless she needs it. Bottom line first. 12-hour times. One step at a time when a decision is heavy.
- Alex Hormozi $100M Offers principles.
- True self-serve SaaS; absorb the keys; one-click setup. Automate the GTM from day one; least effort, most money.
- "Easy to explain = easy to sell and market" is a passing criteria for any angle.
- Do not be a yes-man. Recommend the better path with reasoning, then proceed. She wants promotion of the best idea, not agreement.
- Senior Engineer Mode spine (SCOPE, BUILD, VERIFY, REVIEW, SHIP) and the hard NEVERs: verify through the real path; never claim done without proof; never promise a CTA or behavior that is not wired end-to-end (copy is a contract); do not hide errors or disable checks; do not discard uncommitted work; branch before committing, never push to a shared branch or deploy to production or send outreach on her behalf without it being safe and authorized; a human merges and acts outward.
- Branch and worktree names after the work, never wave/unit numbers.
- Machine limits: 8GB RAM, near-full disk. Never run two heavy builds at once.
- She is a non-dev founder. Teach top-down, use metaphors and named heuristics.

## 7. Assets produced this session

- `docs/gtm-strategy.md` (full strategy, 43 sources)
- `docs/ideation/buying-moments-landscape.md` (the ranked landscape)
- `docs/GTM-CONTEXT.md` (this file)
- Published strategy artifact (read-only web page): https://claude.ai/code/artifact/3135bd93-4cfb-44b6-b425-9cb163eb23ee
- Scratchpad HTML (may not persist; the repo .md files are canonical): `buying-moment-strategy.html`, `buying-moments-landscape.html` in the session scratchpad.

## 8. Open forks still Lilly's to decide

1. **The buyer / niche.** Her steer is up-market to buyers with money; B2B software sellers is the live candidate. Still open. This choice drives which moments matter and the whole positioning.
2. **Brand:** keep "Buying Moment" (owns the domain, plain) or a more distinctive name. USPTO search either way.
3. **The pilot moment(s):** which one or two signals to launch on, given the chosen buyer. Do not build all of them; pick a spear.
4. **Pricing level:** tune to the chosen buyer (B2B software buyers support higher prices than local-business vendors).

## 9. What Lilly described wanting to do next (context only, she will send the real prompt)

She described an overnight build: design 3 shippable landing pages as subpages of lillyfield.co, each intentionally A/B testing a different variable against the others (different niche, positioning, packaging, or pricing), with one of the angles being the techy / B2B-software-seller niche. Plus 1 to 2 viable marketing channels applied evenly across all 3 pages, with the GTM automated from day one, built as if rolling out live tomorrow, optimizing for the most money with the least effort. These are the first GTM experiments. She will provide the exact action prompt herself. Wait for it.
