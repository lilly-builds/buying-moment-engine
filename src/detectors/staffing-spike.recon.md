# U4 source recon — front-desk staffing-spike detector

Mandated first task per build-plan.md U4: pick the most cost-effective,
ToS-clean source with adequate data volume BEFORE writing detection logic.
Done as documentation (no live `JOBS_API_KEY` available in this environment).

## Candidates considered

| Source | Type | ToS basis | Volume for this use case |
|---|---|---|---|
| **Adzuna Jobs API** | Licensed jobs-data API | Registered developer API (`app_id`/`app_key`); Adzuna's [Developer Terms](https://developer.adzuna.com/) explicitly permit programmatic search + redistribution of listing metadata (title, employer, url, created date) for registered apps, rate-limited per key. | Aggregates across Indeed-style postings + many small/local employers — the best coverage of small healthcare/dental/vet practices (Elise AI's actual customer base), which rarely run their own ATS. |
| CareerOneStop (DOL) | Licensed/government API | Public API, free registration, U.S. Dept. of Labor data — clean ToS, but weaker on hyper-local single-practice job posts (skews toward aggregated labor-market stats, not individual live postings). | Lower — good for labor-market context, not per-practice detection. |
| Greenhouse / Lever public board JSON | Public ATS boards | No auth, public `boards-api.greenhouse.io` / `api.lever.co/v0/postings` JSON — ToS-clean (public, documented, no scraping). | Low for this wedge — only covers employers big enough to run Greenhouse/Lever; most small front-desk-hiring practices post to job boards, not a branded ATS page. |
| SerpAPI / JSearch (SERP resellers) | Approved fallback | Licensed reseller of search-engine job results; ToS-clean by contract with the reseller. | Good volume, but a paid per-call cost layered on top of someone else's scrape — worse cost/quality trade than a jobs-data API when one is available. |
| Apify | — | **Dropped.** Not an official/licensed source; excluded by the locked stack policy (official/licensed sources only). |

## Decision: Adzuna Jobs API

Chosen for the best cost/volume/ToS trade: it's a licensed, developer-registered
API (not a scrape), and its aggregation model surfaces postings from the small
independent healthcare/dental/vet practices that are Elise AI's actual buyers —
better fit than an ATS-board approach that only sees larger employers.

Modeled response shape (`GET /v1/api/jobs/{country}/search/{page}`):
```json
{
  "results": [
    {
      "id": "1234567",
      "title": "Patient Coordinator - Front Desk",
      "description": "Answer phones, greet patients, manage the schedule...",
      "company": { "display_name": "Sunshine Dermatology" },
      "location": { "display_name": "Tampa, FL", "area": ["US", "Florida", "Tampa"] },
      "redirect_url": "https://www.adzuna.com/details/1234567",
      "created": "2026-06-30T08:00:00Z"
    }
  ],
  "count": 42
}
```

Fields used: `title` + `description` (classifier input), `company.display_name`
(→ `practiceHint`), `redirect_url` (→ evidence `sourceUrl`, R5), `location.display_name`
(→ `geoKey`), `created` (→ `detectedAt`).

## What U15 must verify live

- Real yield per target metro against a minimum-postings threshold (is there
  enough front-desk-hiring signal per metro to be worth a detector run?).
- Actual field presence/nullability in production responses (this recon models
  the documented shape; live responses may omit `description` or `location`
  more often than the fixture assumes — `normalizeJobToCandidate` already
  treats both as optional, but confirm against real payloads).
- Adzuna's free-tier rate limits vs. run cadence (cron is every 6h per
  `jobs/run-detectors.ts`); confirm `ADZUNA_UNIT_COST_USD` in
  `staffing-spike-adzuna.ts` still reflects the actual paid tier if/when one is
  adopted (currently `0` — free tier — update before scaling query volume).
  Every live call already routes through `ctx.meter` (R19) with `units: 1`
  per fetch, so switching tiers is a one-constant change, not a rewrite.
- `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` must be provisioned as real secrets before
  `fetchAdzunaJobs` can succeed — it throws a clear error today when unset.
