# Test Run #1 — First Real Pipeline Run (2026-07-10)

**What this was:** the first end-to-end run of the pipeline on **live data** (U15 seeding), to answer three questions honestly:
1. Does the pipeline work, start to finish?
2. Does it find good leads?
3. Does it write briefs on those leads?

**One-line verdict:** **Yes on all three** — the pipeline finds real, verifiable leads and writes grounded, cited briefs on them. Two real weaknesses surfaced (brief-writing is flaky on the first try; cross-signal stacking is unproven), both understood and both fixable. See *Caveats* — the briefs in this run were generated on unmerged code and should be regenerated once clean.

---

## Verdict per question

| Question | Answer | Confidence |
|---|---|---|
| 1. Pipeline works end-to-end? | **Yes** — full chain ran on live data: find practice → detect signal → enrich → write cited brief → land on feed | Verified (watched it run) |
| 2. Finds good leads? | **Yes** — 8 real, named practices across all 4 specialties, each qualified from its *actual* Google reviews | Verified (watched Tampa run live) |
| 3. Writes briefs on leads? | **Yes, and grounded** — every claim forced through a citation/truth gate; but the first pass is unreliable (needs more attempts) | Verified mechanism; **citations not yet click-tested** |

---

## Setup: clean-slate wipe (before the run)

The demo database held fabricated seed/test data mixed with real data. Per direction, it was wiped to a true zero baseline so this run starts clean. Removed **only** rows with a `demo:` geo-key (set exclusively by the seed scripts):

| Removed | Count |
|---|---|
| Fake practices (Cedarline "hero", Sandbox test, 5 feed fakes, 12 scoreboard fixtures) | 20 |
| Fake signals / briefs / roi_events / feedback / crm_links / sequences / contacts / evidence | 23 / 2 / 52 / 10 / 20 / 6 / 3 / 20 |
| Fake cost rows (the inflated ~$81 CAC) | 18 (−$81.10) |

**Kept:** 5 real practices, 1 pre-existing real brief, real cost audit. **Result: 0 fake meetings/deals, 0 fake leads.** Idempotent, transactional; the real discovery cache was preserved (no re-pay to re-discover).

---

## Question 2 — Leads found

**8 real practices, all 4 specialties covered, all from live Google Places discovery** (reviews-based phone-complaints signal). Every one is a real, named, verifiable clinic.

| Metro | Specialty | Practice | Signal | Confidence | Brief? |
|---|---|---|---|---|---|
| Austin | Dermatology | Sanova Dermatology — North Austin | phone complaints | 0.72 | ✅ |
| Austin | Women's Health | Austin Regional Clinic: ARC South Ob-Gyn | phone complaints | 0.92 | ✅ |
| Austin | Ophthalmology | Austin Retina Associates — Central | phone complaints | 0.85 | ✅ |
| Austin | Orthopedics | Bone Drs Orthopedic Care | phone complaints | 0.85 | ✅ |
| Austin | Orthopedics | Texas Orthopedics | phone complaints | 0.85 | ✅ |
| Tampa | Ophthalmology | The Eye Institute of West Florida | phone complaints | 0.92 | ⬜ |
| Tampa | Orthopedics | Tampa Bay Orthopedic and Surgery Group | phone complaints | 0.95 | ⬜ |
| Tampa | Orthopedics | Florida Orthopaedic Institute | phone complaints | 0.92 | ⬜ |

**Tampa run detail (live, this session):** enumerated **40** clinics → rating-funnel dropped 10 → checked **30** (read their reviews) → **4 qualified** onto the feed → 36 archived. 0 errors. Positive control passed (non-zero enumeration).

**Honest limits on "good leads":**
- Every lead carries **only one signal type** (phone complaints). **No multi-signal (2+) lead** was produced — see Question below.
- Only the **reviews-based finder** was run this session. The **job-posting (Adzuna)** and **news (GDELT)** finders were **not run**.
- Coverage is 2 metros (Austin, Tampa). Charlotte (the 3rd configured metro) was not run.

---

## Question 3 — Briefs written

**5 real briefs exist**, all on Austin practices (the 3 Tampa leads are not yet briefed). Each brief is built from the clinic's **real website** + enrichment, synthesized by Opus, and **every claim is run through a truth/citation gate that rejects any ungrounded number or vague quantifier.** When a brief passes, its claims are grounded by construction.

**The weakness — first-pass reliability:** the gate is strict and the writer was capped at **2 attempts**. Result: briefs failed and needed re-runs.
- Example: **Austin Retina** failed **5 times** (ungrounded-number / vague-quantifier / too-few sequence touches) before passing on the 6th attempt.
- It took **23 Opus synthesis attempts** (including debugging re-runs) to land the 4 new briefs.

**This is already being fixed** in a parallel work session (`fix/brief-yield-thin-practices`), which bumps the attempt cap 2 → 3 and tunes the gate/prompt. The tool *can* brief every lead — it just needs more attempts than it was allowed.

---

## Cross-signal linking — how a lead gets stacked with other signals

Traced from the code (`src/engine/resolver.ts`):

- The three finders (reviews / jobs / news) each run **independently** and output "Clinic X, in City Y, has Signal Z."
- There is **no active per-lead lookup** ("go check Adzuna for this lead"). Instead, when any finding lands, the code checks: *is there already a clinic in the same city whose name is close enough?*
  - Name match = break both names into words, drop filler (`llc`, `the`, `of`), expand abbreviations (`derm`→`dermatology`), and measure word-overlap. **≥ 0.6 overlap = same clinic** (`nameSimilarity`, `NAME_MATCH_THRESHOLD = 0.6`).
  - Match → the new signal **stacks** onto that clinic (now a 2-signal lead, ranks higher).
  - No match → saved as a new clinic.

**Why this run produced 0 multi-signal leads (two honest reasons):**
1. **Only one finder ran.** With no job/news signals in existence, there was nothing to stack with.
2. **Name-spelling gap.** Reviews name clinics with a location tail ("Sanova Dermatology | Austin – North Austin"); a job post says "Sanova Dermatology." That pair scores ~0.5 — **below the 0.6 bar** — so they'd stay two separate records. Only clean, identical names ("Texas Orthopedics") would reliably stack.

**Status:** the stacking engine is real and correctly built, but **untested end-to-end.** The clean test: run all three finders on one metro (Austin) and watch for a clinic picking up a second signal; consider relaxing the location-tail matching.

---

## Cost (metered, R19) — this run

**This session's real spend: ~$3.28** (229 metered calls). Pre-existing real base (yesterday's Austin discovery + first brief): ~$9.32. Current all-time real total: **$12.04**.

| Step | Calls | Cost | What it is |
|---|---|---|---|
| brief.voice | 23 | $1.435 | Opus brief synthesis (incl. all retries/debugging) |
| discovery.details | 30 | $1.200 | Google Places details + reviews (Tampa) |
| enrich.website | 10 | $0.245 | Website resolve/scrape |
| discovery.classify | 150 | $0.146 | Haiku review-qualification (Tampa) |
| discovery.search | 4 | $0.128 | Google Places text search (Tampa, 4 specialties) |
| enrich.extract | 12 | $0.126 | Claude firmographic extraction |
| **Total** | **229** | **$3.28** | |

**Cost notes:**
- **No PDL / contact-enrichment spend this session** (`enrich.pdl` = $0). The verified-contact step did not fire — the "who to contact" data may be thin and is worth checking.
- Rough unit economics: **Tampa discovery ≈ $1.47 for one metro** (found 3 leads → ~$0.49/lead). **Briefs ≈ $0.10–0.16 each** on a clean pass; the flaky gate multiplies that via retries.

## Timing (approximate)

Wall-clock spans include manual gaps between runs and debugging, so they overstate compute. Clean, contiguous measurements:
- **Discovery, one metro (Tampa):** ~**4.5 min** end-to-end (4 searches + 30 detail fetches + 150 classifications).
- **Brief synthesis:** ~**20–60 s per attempt**; a brief needing retries ran ~2–5 min.
- *(Per-step timing was not instrumented directly — derived from `cost_events` timestamps. A proper timer is a follow-up if precise numbers are needed.)*

---

## What is verified vs. not

**Verified (watched it happen / read the code / queried the DB):**
- Discovery finds real named clinics and qualifies them from real reviews.
- Briefs are written and are grounded (the gate rejects ungrounded claims).
- Full chain runs end-to-end; feed shows real practices with real briefs.
- All spend is metered.

**Not yet verified:**
- **Citations not click-tested** — I have not opened each brief's source links to confirm the link supports the claim (the gate rejecting bad claims is strong evidence, not proof).
- **Cross-signal stacking** — never exercised (only one finder ran).
- **Contact/PDL enrichment** — did not fire this session.
- **HubSpot push / scoreboard from real events** — not exercised.

---

## Caveats (important)

1. **Code provenance.** These briefs were generated while the working directory was on the **unmerged** `fix/brief-yield-thin-practices` branch (its changes touch the synthesizer/gate/prompt). So the current brief *text* comes from a mixed/in-flight code version. **Before showing EliseAI, regenerate all real briefs (`--force`) on clean, merged `main`** so every brief is one shipped version. (The leads/signals are unaffected — discovery code is identical on both branches.)
2. **Retry loop.** Brief completeness in this run relied on an operator retry loop (re-invoking the real pipeline on gate failures). No brief content was authored or edited by hand; the app's gate validated every one. The loop is redundant with the brief-yield fix and should be dropped in favor of it.

---

## Findings → follow-ups

| # | Finding | Suggested action |
|---|---|---|
| 1 | Brief writer flaky on first pass (2-attempt cap too low; strict gate) | Land `fix/brief-yield-thin-practices` (cap 2→3 + prompt/gate tuning) |
| 2 | Cross-signal stacking unproven; only 1 of 3 finders run | Run all 3 finders on one metro; verify a 2-signal lead appears |
| 3 | Name-matching (0.6) may be too strict for location-tail spellings | Consider stripping location/direction tails before matching |
| 4 | No contact/PDL enrichment fired | Investigate why `enrich.pdl` didn't run; the "who to contact" card needs it |
| 5 | Citations not click-tested | Do the citation click-test on the regenerated briefs |
| 6 | Coverage thin (2 metros, 1 signal each) | Add Charlotte; widen freshness within a timebox |

---

*Data source for every number above: live queries against the demo database (`cost_events`, `signals`, `briefs`, `practices`) + observed run output. Nothing estimated except where marked "approximate."*
