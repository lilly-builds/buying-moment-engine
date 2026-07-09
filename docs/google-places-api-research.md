# Research — Google Places API as a Buying-Moment Signal Source

**Purpose:** Decide how the engine uses **Google Places** to power the phone-complaint review signal (Signal Catalog **#2**) *without* forcing non-technical users to create or paste a Google API key — and capture the cost, review-depth, and hosting realities that shape the build.

**Status:** Decision record. **Date:** 2026-07-09.
**Anchors:** `eliseai-spec.md` → Signal Catalog **#2** (phone-complaint reviews) · **D9** (real data / clean sourcing) · **D14** (onboarding — zero setup for AEs) · **Stack** (app-managed vs BYOK vs OAuth).

---

## TL;DR — the architecture decision

> **One app-managed Google Places API key + limit-tiers.**

1. **App-managed key — not OAuth, not per-user BYOK.** *We* (the app) own **one** Google Places key. It lives server-side as an env var (`GOOGLE_PLACES_API_KEY`), never exposed to the browser, never a "connect" screen. Same treatment as Supabase. **Every user — AE, hiring manager, RevOps admin — does zero setup.**
2. **Limit-tiers do the cost + conversion work.** A per-org **soft cap** (the free / "Explorer" tier) sits *below* a global **hard cap** (Google budget + quota). Soft cap = the product's conversion moment (a branded CTA). Hard cap = wallet backstop.
3. **Why not OAuth:** Google Places returns *public* business data about *other* practices — there is no "your data" for a user to grant access to, so no OAuth flow exists for it. OAuth stays reserved for HubSpot, where the data really is the customer's.
4. **Demo → production is a one-line swap.** For evaluation the key is Lilly's; in production EliseAI drops in *their* GCP key (same code, different secret) so Places usage bills to their cloud account. Still set once by whoever deploys — never by an end user.

**Heuristic — the three buckets of keys:**

| Bucket | For… | User experience | Our tools |
|---|---|---|---|
| **Connect (OAuth)** | a user's *own private data* in another app | clicks "Connect," grants access | **HubSpot** (their CRM + inbox) |
| **BYOK (paste a key)** | *metered spend that should bill to the customer* | pastes their key in settings | **Anthropic, PDL** |
| **App-managed (built-in)** | the app's *own shared utility on public data* | sees nothing — it just works | **Supabase**, **Google Places** |

Google Places is public-data infrastructure → **bucket 3**. That is the whole decision.

---

## Why OAuth is the wrong tool (the mental-model fix)

OAuth only works when there is *"your data"* for a user to consent to sharing. **Google Places is public info about the practices we're prospecting — nobody owns it — so there is nothing to consent to.** Google authenticates the *app's project* via an API key, full stop.

**Pre-empt the obvious objection** — "but Google *does* have OAuth, I've clicked 'Sign in with Google'." True: that user-consent OAuth covers Gmail, Calendar, and **Google Business Profile** (a business owner granting access to reviews on *the listing they own*). That last one sounds close but is useless here — it only exposes reviews for listings *you* manage, not the hundreds of *other* practices we research. Wrong tool for prospecting.

*(Google did add OAuth-token auth to a few Maps APIs, but it's a server-side/enterprise mechanism that is **more** setup than a key, not less — it does nothing for the "no setup for non-technical users" goal.)*

---

## The hosting reality that forces this decision

The spec's ownership model assumed *"the customer runs it on their keys."* During the **job-application / evaluation phase**, the truth is different and is what makes app-managed + limit-tiers necessary:

> **Lilly hosts one instance; multiple prospective-employer orgs evaluate it with zero setup.** She is the **operator** during evaluation — on the hook for cost, and for keeping each org's data isolated (spec's RLS / multi-tenant handles isolation).

No org's RevOps will stand up a Google Cloud project to try an applicant's demo. So the key must be app-owned and invisible, and usage must be metered per org.

### The two-cap model (keep these separate)

| Cap | Where it lives | Job | Behavior when hit |
|---|---|---|---|
| **Soft cap** (free / "Explorer" tier) | our app, **per org** | create the conversion moment | graceful branded CTA — "hire Lilly" |
| **Hard cap** (budget + quota) | Google Cloud, global | protect the wallet, last resort | API stops answering |

**Set the soft cap well *below* the hard cap** so the polished "you've hit the Explorer limit" moment always fires *before* any ugly Google billing wall.

### The CTA / free-limit tier — a growth flex, not a hack

The free-limit popup is a **product mechanism**, not just cost protection (the $1 budget cap already handles cost — see below). For a **Growth Engineer** application it *demonstrates the skill on the table*: activation gating + usage-based conversion.

- **Tone:** confident and product-grade (looks like part of the EliseAI-branded tool), not cutesy/desperate.
- **Trigger:** at a *value moment* — after they've worked several briefs — not on arrival.
- **The recursive win:** log *which org* hits the limit and *when*. An org's hiring manager hitting the free wall **is a buying-moment signal — for hiring Lilly.** The tool that finds buyers finds its own buyer. (A line worth saying out loud in interviews.)

---

## Cost model

**Unit that matters:** one **"pull"** = fetching one practice's details *including its reviews* (the phone-complaint signal). Reviews are the priciest thing Google sells, so everything below is priced against that worst case.

| What you're doing | Google SKU tier | Cost per call *beyond* free | Free per month *(approx — verify)* |
|---|---|---|---|
| Basic lookup (name, address, status) | Essentials | ~0.5–1.7¢ | ~10,000 |
| Search to *find* a practice | Pro | ~3¢ | ~a few thousand |
| **Get a practice's reviews** (our signal) | **Enterprise + Atmosphere** | **~2.5¢** | **~1,000 — the binding limit** |

- **Full fresh pull** = find + reviews ≈ **2 calls, ~5¢ all-in** beyond free.
- **Safe planning floor:** treat **~1,000 free review-pulls/month** as the number to hold in your head (may be several thousand — plan against 1,000 and never be surprised).
- **Beyond free:** pure pay-as-you-go, ~5¢ per fresh practice. No minimum, no commitment. Even 10,000 fresh practices/month ≈ ~$500 — a *production* volume, on EliseAI's key, not ours.

### Why the real bill at demo scale is $0

- **The feed is pre-seeded and cached** (spec D9 + D13). Practices are pulled *once* and stored with their signals + citations. Evaluators scrolling the feed read our database, **not Google** → $0.
- **Only fresh pulls count** — a live "paste a new practice" lookup. Realistically 5 orgs × a few people × ~20 lookups ≈ **300–600/month** → half the conservative free floor.
- The free tier is **1–2 orders of magnitude above** evaluator usage.

### "Enterprise + Atmosphere" is a price bucket, NOT a gated plan

Reviews are **not** blocked behind an enterprise contract, sales call, or minimum spend. "Enterprise + Atmosphere" is Google's **label for a pricing tier of API fields** — like a menu price category, not a membership level. Any pay-as-you-go account (just a card on file) can request the `reviews` field; Google bills that call at the top rate and draws from that SKU's free allowance first. Self-serve, same key, same card.

---

## The real constraint: review DEPTH, not price

The official Places API returns a **maximum of ~5 reviews per place** — Google's own relevance-ranked (or newest) picks — with **no pagination** to reach reviews 6, 7, 8…. That ~5 is the ceiling for any practice we **don't own** (the "all reviews" path exists only via Google Business Profile, for listings *you* manage).

**So price was never the risk — review depth is.** If a practice's phone complaints aren't in Google's top surfaced reviews, the official API won't hand them over.

---

## Strategy — increasing review quantity & variety

### 1. The relevant-vs-newest dedupe (the ceiling of re-pinging)

> You can ask for reviews sorted **"most relevant"** and, in a second call, **"newest"** — then dedupe the overlap. Those two sets often differ, so you can net **up to ~10 distinct reviews instead of 5**. That's the ceiling of what re-pinging can honestly buy you.

**Note:** pinging the *same* request 2–3× gets you nothing — you get the identical 5 back and pay 3× for it. Only *varying the sort* yields new reviews.
**⚠️ Verify:** the *legacy* Places API supported a review-sort parameter; confirm the **new** Places API (2026) still exposes relevant-vs-newest before relying on this. → see Open Questions.

### 2. Research direction — other ways to increase variety & quantity (for a better read on the lead)

Deeper, more varied review coverage = a sharper understanding of the lead's actual phone pain. **Open research thread — investigate additional honest levers**, e.g.:
- **Sort/parameter variants** beyond relevant/newest (language, filtering) — check what the new API actually supports without ToS violation.
- **Second sources per practice** (Yelp, Healthgrades) as independent corroboration — each cited, strengthening the D2 "cited claim" (the same phone pain across independent sites is a *stronger* signal, not a weaker one).
- **Signal composition** — combine review *text* (keywords: "can't get through," "on hold," "no one answers") + rating pattern + review volume, rather than leaning on any single review.
- **Freshness weighting** — how recent the complaints are (spec D7 freshness badge).

**Do NOT** scrape Google reviews for the full set — breaks Google ToS and the spec's "official APIs only / clean sourcing" rule (D9). Variety comes from **more sources, not more pings** — you widen, you don't re-drill one well.

### 3. v1 (not beta) — expand to more sources

For the **demo/beta**, Google's ~5–10 reviews per seeded practice is enough to *prove the signal fires* on real, citable evidence. **In v1 (post-beta), expand Signal #2 to the full multi-source set** — Google **+ Yelp + Healthgrades** (exactly the sources Signal Catalog #2 already names) — for real quantity, variety, and cross-source verification. Document the depth cap honestly until then; "licensed full-review feed" is the eventual production upgrade.

---

## Setup — do once (whoever deploys)

1. **Create a project** — [console.cloud.google.com](https://console.cloud.google.com) → New Project → `eliseai-signals`.
2. **Enable billing** — link a card (required even for free usage; confirm current free-tier numbers on this screen).
3. **Enable the API** — search "**Places API (New)**" → Enable.
4. **Create the key** — APIs & Services → Credentials → Create Credentials → API key.
5. **Restrict the key** — restrict to **Places API (New)**; add a server-IP restriction later.
6. **Wallet guardrails (do at setup):**
   - **Budget alert** — Billing → Budgets & alerts → **$1** budget, alerts at 50/90/100%.
   - **Quota cap** — APIs & Services → Places API → Quotas → low daily request limit (hard ceiling; API stops instead of billing).
7. Paste the key into server env as `GOOGLE_PLACES_API_KEY`.

---

## Verification status (per verification discipline)

| Claim | Status |
|---|---|
| App-managed key (not OAuth) is the correct auth model; Places is public data | ✅ **verified** (how the platform is designed) |
| "Enterprise + Atmosphere" = self-serve price bucket, reviews not plan-gated | ✅ **verified** (concept) |
| ~5 reviews per place, no pagination for practices we don't own | ✅ **verified** |
| Per-call pricing (~2.5¢ reviews / ~5¢ full pull) | ✅ **verified** — stable across Google's old + new pricing |
| Exact free-tier counts (~1,000 review-pulls/mo) and SKU tier **names** | 🟡 **approximate** — Google moved to per-SKU monthly free volumes in 2025; **read live pricing page** |
| New Places API still supports relevant-vs-newest review sort | ⬜ **unverified** — confirm on live docs before building the ~10-review strategy |

## Open questions → next verification pass (pull live 2026 docs)

1. Does the **new** Places API expose the relevant-vs-newest **review sort**? (Gates the ~10-review strategy.)
2. Exact **free-tier count** for the reviews SKU in 2026.
3. Official **SKU tier names** + the exact **field mask** that returns review text.
4. What other honest **parameters** widen review variety without ToS risk?
