# Research — Google Places API as a Buying-Moment Signal Source

**Purpose:** Decide how the engine uses **Google Places** to power the phone-complaint review signal (Signal Catalog **#2**) *without* forcing non-technical users to create or paste a Google API key — and capture the cost, review-depth, citation, and hosting realities that shape the build.

**Status:** Decision record. **Date:** 2026-07-09. **Live-docs verification pass:** 2026-07-09 (see table + Sources).
**Anchors:** `eliseai-spec.md` → Signal Catalog **#2** (phone-complaint reviews) · **D2** (cited claims) · **D9** (real data / clean sourcing) · **D13** (raw-vs-derived) · **D14** (onboarding — zero setup for AEs) · **Stack** (app-managed vs BYOK vs OAuth).

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

| What you're doing | Google SKU tier (verified name) | Cost per 1,000 *beyond* free | Free per month |
|---|---|---|---|
| Basic lookup (id, name, address) | Place Details Essentials | ~$5 (~0.5¢/call) | ~10,000 |
| Search to *find* a practice | Text Search (Pro) | ~$32 (~3.2¢/call) | ~a few thousand |
| **Get a practice's reviews** (our signal) | **Place Details Enterprise + Atmosphere** | **~$40 (~4¢/call)** | **smallest allotment — the binding limit** |

- **Full fresh pull** = find + reviews ≈ **2 calls, ~7¢ all-in** beyond free.
- **Safe planning floor:** treat **~1,000 free review-pulls/month** as the number to hold in your head.
- **Beyond free:** pure pay-as-you-go, ~7¢ per fresh practice. No minimum, no commitment. Even 10,000 fresh practices/month ≈ ~$700 — a *production* volume, on EliseAI's key, not ours.

**⚠️ 2026 pricing is in flux.** Google retired the universal $200/month credit (Feb 28 2025) and moved to **per-SKU** free tiers (each SKU consumes its own allotment — no shared pool); some sources also show newer plan-based tiers (Essentials/Pro/Enterprise with 100k–250k included calls). Google's own pages didn't state the Enterprise+Atmosphere free count cleanly → **read your account's actual allotment on the billing console at setup.** The decision is unchanged either way.

### Why the real bill at demo scale is $0

- **The feed is pre-seeded and cached** (spec D9 + D13). Practices are analysed *once*; the AE reads our database, **not Google** → $0. *(Storage caveat: we store the Place ID + our derived signal, not Google's review content — see Citation section.)*
- **Only fresh pulls count** — a live "paste a new practice" lookup, or a citation click. Realistically 5 orgs × a few people × ~20 lookups ≈ **300–600/month** → half the conservative free floor.
- The free tier is **1–2 orders of magnitude above** evaluator usage.

### "Enterprise + Atmosphere" is a price bucket, NOT a gated plan

Reviews are **not** blocked behind an enterprise contract, sales call, or minimum spend. "Enterprise + Atmosphere" is Google's **label for a pricing tier of API fields** (verified: 5 tiers — *Essentials IDs Only · Essentials · Pro · Enterprise · Enterprise + Atmosphere*) — like a menu price category, not a membership level. Any pay-as-you-go account (card on file) can request the `reviews` field via the field mask `X-Goog-FieldMask: reviews`; Google bills that call at the top rate and draws from that SKU's free allowance first.

---

## The real constraint: review DEPTH, not price

The official Places API returns a **maximum of ~5 reviews per place** — Google's own relevance-ranked picks — with **no pagination** to reach reviews 6, 7, 8…. That ~5 is the ceiling for any practice we **don't own** (the "all reviews" path exists only via Google Business Profile, for listings *you* manage).

**So price was never the risk — review depth is.** If a practice's phone complaints aren't in Google's top surfaced reviews, the official API won't hand them over.

---

## Citing reviews — store the LINK *path*, not the text (the compliant pattern)

**Question we researched:** can we save direct **links** to reviews for citation (D2), instead of storing review text?

**Findings — verified against Google's policies page:**
- Every review carries a **`googleMapsUri`** — *"a link to show the review on Google Maps."* There's also `authorAttribution.uri` (author profile) and `authorAttribution.photoUri`, plus the text fields `text` (localized) and `originalText`.
- **But** Google treats review content *and its URLs* as cache-restricted: *"You must not pre-fetch, cache, or store Places API content beyond the allowed exceptions."* Reviews are **not** an exception (the only 30-day cache exception covers lat/lng/distance/duration/ETA — not reviews).
- **The one thing you may store indefinitely is the `place ID`** — explicitly exempt from caching restrictions.
- Attribution is **required**: show the author (avatar/name/profile link), and *"end-users must always have access to view the individual source photo or review on Google Maps using the provided `googleMapsUri`."*

**So the compliant citation design (and it's actually cleaner):**
1. **Store the Place ID** (indefinite, allowed) + your **derived signal** — "phone-complaint detected, matched keywords, score, `detected_at`." *That's OUR data (D13 raw-vs-derived), not Google's content → no restriction.*
2. **Don't persist review text or review URLs long-term.**
3. **At citation/verify time** (AE clicks "verify this claim" — D2), do a **live Place Details fetch** by Place ID → render the current review(s) with proper attribution + the `googleMapsUri` click-through to Google Maps.
4. This doubles as **freshness** (D7): the citation is always current, and the live fetch only fires when actually clicked (low volume, low cost).

**Bottom line:** links are the right instinct, but the *fully* clean pattern is **store Place ID + our derived analysis; fetch the review + its link live on click.** Persisting the `googleMapsUri` itself is a grey area (it's Places content); Place-ID-plus-live-fetch is defensible — and that matters for a portfolio piece a hiring manager may inspect (D9 clean sourcing).

---

## Strategy — increasing review quantity & variety

### 1. The relevant-vs-newest dedupe — works ONLY on the legacy endpoint

> You can ask for reviews sorted **"most relevant"** and, in a second call, **"newest"** — then dedupe the overlap. Those two sets often differ, so you can net **up to ~10 distinct reviews instead of 5**. That's the ceiling of what re-pinging can honestly buy you.

**✅ Verified — with a hard catch.** This only works on the **legacy** Place Details endpoint, which exposes `reviews_sort=most_relevant|newest`. The **new** Places API (`places.get`) accepts *only* `languageCode`, `regionCode`, `sessionToken`, and the field mask — **no review-sort parameter at all.**
- **New API:** ~5 reviews in "most relevant" order, **no way to fetch "newest"** → capped at ~5.
- **Legacy API:** the two-call relevant+newest dedupe works → up to ~10.
- **Trade-off:** legacy is on Google's deprecation path (still functional, no new features, could sunset). Betting the core signal on a deprecating quirk is fragile.

**Note:** pinging the *same* request 2–3× gets you nothing — identical 5 back, paid 3×. Only *varying the sort* (legacy only) yields new reviews.

**Recommendation:** don't hang review depth on the legacy sort trick. Treat the New-API ~5 as the floor and get real depth from **multiple sources** (§2–§3) — durable, and independent of a deprecating endpoint.

### 2. Research direction — other honest ways to widen quantity & variety (for a better read on the lead)

Deeper, more varied review coverage = a sharper understanding of the lead's actual phone pain. **Open research thread — investigate additional honest levers:**
- **`languageCode` variants** — the New API's only review-affecting parameter (no sort/filter exists). Different language codes *can* surface different-language reviews, but returns translations → low-value and messy. Not a reliable depth lever.
- **Second sources per practice** (Yelp, Healthgrades) as independent corroboration — each cited, strengthening the D2 "cited claim" (the same phone pain across independent sites is a *stronger* signal, not a weaker one). **This is the durable answer.**
- **Signal composition** — combine review *text* (keywords: "can't get through," "on hold," "no one answers") + rating pattern + review volume, rather than leaning on any single review.
- **Freshness weighting** — how recent the complaints are (D7 freshness badge).

**Do NOT** scrape Google reviews for the full set — breaks Google ToS and the spec's "official APIs only / clean sourcing" rule (D9). Variety comes from **more sources, not more pings** — you widen, you don't re-drill one well.

### 3. v1 (not beta) — expand to more sources

For the **demo/beta**, Google's ~5 reviews per seeded practice is enough to *prove the signal fires* on real, citable evidence. **In v1 (post-beta), expand Signal #2 to the full multi-source set** — Google **+ Yelp + Healthgrades** (exactly the sources Signal Catalog #2 already names) — for real quantity, variety, and cross-source verification. Document the depth cap honestly until then; "licensed full-review feed" is the eventual production upgrade.

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

## Verification status (live-docs pass, 2026-07-09)

| Claim | Status |
|---|---|
| App-managed key (not OAuth) is the correct auth model; Places is public data | ✅ **verified** |
| Reviews live in the **Place Details Enterprise + Atmosphere** SKU (5 tiers total); self-serve, not plan-gated | ✅ **verified** on Google docs |
| Field mask to get reviews: `X-Goog-FieldMask: reviews` (no spaces) | ✅ **verified** |
| Review object has `googleMapsUri`, `authorAttribution.uri/photoUri`, `text`, `originalText` | ✅ **verified** |
| Review content + URLs are cache-restricted; only **Place ID** stored indefinitely; attribution + `googleMapsUri` access required | ✅ **verified** on policies page |
| New API `places.get` has **NO review-sort param** → relevant/newest dedupe is **legacy-only** | ✅ **verified** — *reverses the earlier assumption* |
| Reviews-SKU per-call price (~$40/1,000 ≈ 4¢) + per-SKU free tier | 🟡 **approximate** — 2026 pricing in flux; not stated cleanly on Google's pages → **confirm on billing console** |
| ~5 reviews max per place on the New API | 🟡 **strong** — long-standing limit; New-API reference states no explicit max → treat 5 as the working ceiling |

## Open questions → remaining judgment calls

Most of the original list is now answered (see table). What's left is decisions, not lookups:

1. **Legacy vs. New endpoint for the review signal.** New = clean/future-proof but ~5 reviews, no sort. Legacy = ~10 via sort dedupe but deprecating. **Lean New + multi-source** (durable) unless demo depth demands the legacy trick short-term.
2. **Exact 2026 free-tier count** for the Enterprise+Atmosphere SKU — read off the billing console at setup (decision doesn't hinge on it; free at demo scale regardless).
3. **v1 source order** — Yelp vs. Healthgrades first for the second review source (§3).

---

## Sources (live-docs pass, 2026-07-09)

- [Places API (New) — Place / Review reference](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places) — Review fields incl. `googleMapsUri`, `authorAttribution`, `text`, `originalText`.
- [places.get method reference](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places/get) — confirms only `name`/`languageCode`/`regionCode`/`sessionToken`; no review-sort param.
- [Place Details (New)](https://developers.google.com/maps/documentation/places/web-service/place-details) — SKU tiers + `X-Goog-FieldMask`.
- [Places API policies & attribution](https://developers.google.com/maps/documentation/places/web-service/policies) — caching restrictions, Place-ID exemption, attribution + `googleMapsUri` access requirement.
- [Place Details (Legacy)](https://developers.google.com/maps/documentation/places/web-service/legacy/details) — `reviews_sort=most_relevant|newest`.
- [Places API usage & billing](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing) — $200 universal credit retired Feb 28 2025.
