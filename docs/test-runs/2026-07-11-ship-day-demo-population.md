# Test Run #2 — Ship-Day Demo Population (2026-07-11)

**What this was:** Thread 03 — the ship-day run that fills the live demo EliseAI will open. Fire the real sources, brief what lands, across all four verticals, on the **real prod DB** (`grfitrxtheolzfuautse` Supabase — confirmed as the DB `buying-moment-maestro.vercel.app` reads). Every row is real and permanent.

**One-line verdict:** **25 real, named practices** at a live buying moment across **all four verticals**, **100% briefed** with grounded, click-tested citations. **0 multi-signal leads** — root cause diagnosed and verified (a cross-source `geo_key` format mismatch; a BUILD fix, not a data problem). Total run spend **$15.01**.

---

## Result vs. goal

| Goal (Thread 03) | Result | Status |
|---|---|---|
| ~20 real practices at a buying moment | **25** | ✅ exceeded |
| All four verticals | derm 3 · women's health 10 · ophthalmology 4 · orthopedics 8 | ✅ |
| Each with a real cited brief | **25/25 briefed (100%)**, citations click-tested | ✅ |
| ≥1 multi-signal (2+) lead | **0** — structural block, diagnosed & verified | ⚠️ not a blocker (per 07) |
| Real, not fabricated (D9) | 0 `demo:` rows; every lead a real geo key | ✅ |
| Cost-disciplined + metered (R19) | $15.01 this run, every call in `cost_events` | ✅ |

---

## Leads (25) by metro × vertical

| Metro | derm | women's health | ophthalmology | orthopedics | total |
|---|---|---|---|---|---|
| Charlotte, NC | 2 | 2 | 1 | 1 | **6** |
| Houston, TX | – | 4 | – | 2 | **6** |
| Austin, TX | 1 | 1 | 1 | 2 | **5** |
| Dallas, TX | – | 1 | 1 | 1 | **3** |
| Tampa, FL | – | – | 1 | 2 | **3** |
| Phoenix, AZ | – | 2 | – | – | **2** |
| **Total** | **3** | **10** | **4** | **8** | **25** |

Vertical mix is honest, not curated: OB/GYN practices draw far more "can't reach the front desk" reviews than dermatology, so the phone-complaints qualifier surfaces more of them. Derm (3) is the thinnest — real, just fewer qualifying reviews.

## Sources — which actually fired

| Source | Fired? | Yield |
|---|---|---|
| **Practice discovery** (Google Places text-search → review qualifier) | ✅ 6 metros | **25 qualified leads** — the workhorse; emits the `phone_complaints` signal from real reviews |
| **Staffing spike** (Adzuna) | ✅ (Charlotte engine run) | **0 signals landed.** Default national query returns ~0 practice-shaped candidates; and candidates can't stack (see below) |
| **Growth events** (GDELT) | ✅ (Charlotte engine run) | **0 signals landed.** One fetch failed (keyless, flaky), retry returned 0 candidates |
| **Phone complaints detector** | 🌑 dark by design | 0 candidates — empty place-id list, as speced. (The feed's `phone_complaints` signals come from *discovery's* review-qualifier, not this detector.) |

Note on method: the deployed cron (`/api/cron/run-engine`) sits behind Vercel deployment-protection (returns a 307 auth-gate to any external caller) and `CRON_SECRET` is not in local env, so the engine was run **locally via the identical `runEngine` orchestration** (same code path, live keys, prod DB) — one full engine run for the rotation metro (Charlotte) firing all three live sources, then per-metro discovery via `probe-discovery` + `run-pipeline` for breadth.

## Multi-signal — why 0, verified

`resolvePractice` (src/engine/resolver.ts) hard-gates a signal onto an existing practice by **exact `geo_key` equality first**, then name similarity ≥0.6. The three sources derive `geo_key` in **incompatible formats**:

- **Discovery** → `metroToGeoKey("Houston, TX")` = `houston-tx` (city-**stateAbbr**)
- **Adzuna** → `slugifyGeo(job.location.display_name)` = `houston-harris-county` (city-**county**) — confirmed live: Adzuna's `location.display_name` is `"Houston, Harris County"`
- GDELT → likely a third format

Because `houston-tx` ≠ `houston-harris-county`, an Adzuna/GDELT hit **can never match a discovery lead's geo key** — it lands as a new *unclassified* practice (no vertical pack → invisible to the feed) instead of stacking. So cross-source stacking is structurally impossible in the current build; single-source-only is the expected result until the sources share a geo-key derivation.

**Refines Run #1 finding #3:** the blocker is upstream of name-matching — the geo hard-gate never lets a candidate reach the name comparison. This is a **BUILD fix** (normalize `geo_key` across all sources to one canonical form), out of scope for this RUN thread. No multi-signal lead was fabricated.

## Contacts (who-to-contact)

Over the 25 feed leads: **10 have a contact row, 8 named + role, 6 with LinkedIn, 0 with a verified work email.** Claude's research supplies name/role/LinkedIn for small practices; **PDL returns no match** on these independent clinics (`pdl_discovery_no_match`, `billedRecords: 0`) so the verified work email stays empty. This is D9's honest degradation — a practice with no findable contact stays role-only and never invents an address. Verified-email coverage is the real thin spot.

## Verification

- **Citations click-tested:** 18/18 sampled cited URLs live (HTTP 200), **10/10 firmographic-fact snippets verbatim-supported** on the fetched page, 0 dead links. Phone-complaint signals cite the live Google Maps page (review text not persisted — ToS-clean).
- **Feed data:** `feedPractices()` (the exact query `app/page.tsx` server-renders) returns all 25 real briefed leads.
- **Feed UI render:** login gate (R18) works; visual render requires an allowlisted-inbox magic-link login (allowlist = Lilly's addresses), so a pixel screenshot is a Lilly-side check on prod (same DB).

## Cost (metered, R19)

**This run: $15.01.** All-time real total: **$27.06** (1,922 metered calls).

| Step | This-run est | What it is |
|---|---|---|
| discovery.details | ~$6.5 | Google Places details + reviews (6 metros) |
| brief.voice | ~$3.6 | Opus brief synthesis (~20 new briefs incl. retries) |
| enrich.pdl | ~$2.2 | PDL contact lookups (mostly no-match on small practices) |
| enrich.website + extract | ~$1.5 | Website resolve/scrape + firmographic extraction |
| discovery.classify + search | ~$1.4 | Haiku review-qualify + text search |

Rough unit economics: discovery ≈ **$1.3–2.6 / metro** (~$0.3–0.5 / qualified lead); briefs ≈ **$0.10–0.18 each** (clean pass ~$0.10; strict truth-gate retries add the rest); PDL ≈ **$0.28 / named contact**, $0 for verified email.

## Honest limits / follow-ups (for Thread 07)

1. **0 multi-signal** — structural geo-key mismatch across sources (above). BUILD fix: canonicalize `geo_key`.
2. **Verified email = 0** — PDL doesn't match small independent practices. "Who to contact" is name+role(+LinkedIn) for ~a third, empty for the rest.
3. **Adzuna default query yields ~0 practice candidates** — the national multi-token `what` is too narrow; needs per-metro/specialty tuning (the detector already supports `queries`).
4. **Vertical mix is women's-health-heavy (10) and derm-thin (3)** — honest reflection of review-evidenced phone pain, not a bug. Derm can be topped up with a derm-targeted metro if desired.
5. **5 Austin briefs** predate this run (2026-07-10, on the now-merged `fix/brief-yield` branch). Not regenerated: the synthesizer code is identical to shipped `main`, and regenerating risks turning a currently-valid brief invalid on the stochastic gate for no correctness gain. All 5 verified real + cited.
6. **5 unclassified orphan practices** (Atlanta/Omaha/Charleston/Nashville/Austin) from earlier experiments — zero signals, invisible to the feed. Harmless; left untouched (not `demo:`-prefixed, but never surface).

---

*Every number above is a live query against the prod DB (`cost_events`, `signals`, `briefs`, `practices`, `contacts`) or observed run output. Sources ran locally through the identical `runEngine`/discovery/pipeline code the cron uses. Nothing sent, no practice contacted, zero PHI (D9).*
