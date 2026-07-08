# EHR-as-incumbent-tooling — source recon

**Date:** 2026-07-08 · **Context:** U6 (brief synthesizer) · **Verdict:** do not build in U6; a
cheap unlock exists in U4.

## The problem

R4 promises the call-prep card shows **incumbent tooling**, and the vertical packs use
**EHR-as-signal** (variable #4). U5 measured that practices **do not publish their EHR on their
own websites** — `Claude -> EHR: never found, n=7`. PDL holds no firmographics at all
(`0/3`). So the field the card promises has no source.

## Lilly's hypothesis (2026-07-08)

> Practices name their EHR in job postings — "must have ModMed experience." And Adzuna is live.

This is right, and it is bench signal #9 ("job-post text mining") in the spec's Signal Catalog.

## Why it cannot be harvested from what U6 already holds

Two independent blockers, both verified.

### 1. We store a teaser, not the posting · `verified (n=20)`

Adzuna truncates every `description` to **exactly 500 characters**, ending in `…`
(20/20 sampled, one live call against the detector's own query
`what=patient coordinator front desk`). `src/detectors/staffing-spike-adzuna.ts` then stores
only `description.slice(0, 240)` as the evidence snippet — discarding 260 characters we
already fetched.

**In that stored text, an EHR is named in 0 / 20 postings.** Even at the full 500 characters
the teaser rarely reaches the requirements section where the EHR lives.

### 2. Pack EHR names are display names, not match tokens

`ehrSignals[].name` is `"ModMed EMA (Dermatology)"`; `buildEhrIndex()`
(`src/engine/verticals.ts`) normalizes it to `"modmed ema"`. A posting that says `"ModMed"`
does not match. Auto-deriving a vendor token from the leading word would fix ModMed and
simultaneously derive **`"phoenix"` from `"Phoenix Ortho"`** — fabricating an EHR for every
practice in Phoenix, Arizona. That is precisely the stitched-together claim
`src/enrich/citations.ts` exists to catch, and it would ship as a cited fact.

## The unlock — a U4 change, and it is cheap · `verified (n=30)`

**Adzuna's full-text search matches the whole job description even though the API returns only
a teaser.** Querying by EHR name returns real volume:

| query | total US postings | term visible in the 500-char teaser |
|---|---|---|
| `ModMed` | 201 | 1 / 10 |
| `Nextech` | 610 | 9 / 10 |
| `eClinicalWorks` | 1,396 | 5 / 10 |

So the harvest is a **search-side** move, not a scrape and not an LLM call:

1. **U4** — add an EHR-name query dimension to `staffing-spike` (one query per pack EHR
   token). The employer of every returned posting named that EHR in its posting.
2. **U4** — raise the snippet slice from `240` to `500`. One character. Adzuna already sent
   the bytes; we are throwing away the half most likely to contain the requirements text.
3. **U5/resolver** — emit an `ehr` `practice_facts` row **only when the EHR name appears
   verbatim in the stored snippet**, citing the posting's `redirect_url`. Anything else has no
   contiguous span that proves it, and must be omitted (the `citations.ts` QUOTATION rule
   applies unchanged).

Under rule 3 the provable yield tracks the right-hand column above — high for Nextech,
mid for eClinicalWorks, low for ModMed. That is an honest fraction of a field that currently
has **no** source at all, and every emitted fact would carry a verbatim snippet plus a
text-fragment deep link straight to the sentence.

## What U6 does in the meantime

`incumbentTooling` renders whatever the U5 website scrape actually found (`ehr`,
`incumbent_tooling_N` rows in `practice_facts`). When the scrape found nothing, the section is
**omitted** — absence renders as absence. No placeholder, no guess, and no "unknown".

## Operational note found during this recon

The worktree `~/Developer/bme-wave-3-u5/.env.local` is a **partial copy**: it carries the stale
`JOBS_API_KEY` and is **missing `ADZUNA_APP_ID` / `ADZUNA_APP_KEY`** (they live in the main
clone's `.env.local`). A live detector run from this worktree would silently emit zero
staffing-spike candidates — the exact failure the Wave-3 status memo warns about for a fresh
clone. Measurements above were taken from `~/Developer/buying-moment-engine`.
