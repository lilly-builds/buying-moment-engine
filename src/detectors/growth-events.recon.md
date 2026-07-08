# U4 source recon — growth-events detector

Mandated first task per build-plan.md U4: pick the most cost-effective,
ToS-clean source with adequate data volume BEFORE writing detection logic.
Done as documentation (no live news-API key available in this environment).

## Candidates considered

| Source | Type | ToS basis | Fit for this use case |
|---|---|---|---|
| **GDELT DOC 2.0 API** | Free, keyless global news index | GDELT is an open dataset/API (the GDELT Project) published specifically for public querying of global news metadata (article `url`, `title`, `seendate`, `domain`, language, source country) — no auth, no scraping, returns metadata + a link back to the original publisher rather than redistributing full article text. | Primary lead: broad, continuously-updated global news coverage, the best free source for catching PE-deal / acquisition / expansion announcements naming a specific practice, across every metro at once. |
| NewsAPI / Bing News (general news API) | Licensed, paid-tier news API | Registered developer API with a commercial terms-of-service; ToS-clean by contract. | Optional paid supplement, NOT built in this pass (scope discipline) — would improve recall/freshness over GDELT's index lag, at a per-call cost. If added later, every call must route through `ctx.meter` (R19) with its real per-request cost, the same pattern already wired for GDELT. |
| Google Business (profile updates / posts) | — | **No official third-party monitoring path exists** (per the plan) — do NOT lead with it. | Dropped as a primary or supplementary source. |
| Practice's own site (change detection on "new providers/locations" pages) | Direct, ToS-clean | Reading a practice's own public site is ToS-clean by definition (it's their own published content). | Acceptable ToS-clean supplement for corroboration (e.g. confirming a GDELT-detected expansion against the practice's own "new location" page), NOT built in this pass — would need a per-practice site crawl, out of scope for U4. |
| PE/healthcare-industry trade press scrape (direct site scraping) | — | **Dropped.** Scraping a publisher's site directly (vs. querying a licensed index like GDELT that already indexes that same press) risks violating that publisher's own ToS; GDELT already surfaces this coverage without the scrape. | — |

## Decision: GDELT DOC 2.0 API (primary), no paid supplement built

Chosen for the best cost/volume/ToS trade: free, keyless, broad global news
coverage, and ToS-clean by design (a metadata index of public news, with links
back to the original source — never full-text redistribution). A paid news API
is documented above as an optional future supplement but is out of scope for
this build per the scope-discipline instruction — GDELT alone is sufficient to
demonstrate the detector end-to-end.

Modeled response shape (`GET /api/v2/doc/doc?query=...&mode=artlist&format=json`):
```json
{
  "articles": [
    {
      "url": "https://healthbizjournal.example.com/2026/06/28/riverside-partners-acquires-sunshine-family-dental",
      "url_mobile": "",
      "title": "Riverside Partners Acquires Sunshine Family Dental in Regional Expansion Deal",
      "seendate": "20260628T140000Z",
      "socialimage": "https://healthbizjournal.example.com/img/1.jpg",
      "domain": "healthbizjournal.example.com",
      "language": "English",
      "sourcecountry": "United States"
    }
  ]
}
```

Fields used: `title` (classifier input — growth-event phrase + practice-name
extraction, see `growth-events-classifier.ts`), `url` (→ evidence `sourceUrl`,
R5), `seendate` (→ `detectedAt`, parsed from GDELT's compact
`YYYYMMDDTHHMMSSZ` format), `sourcecountry` (→ `geoKey`, country-level only —
GDELT's DOC API doesn't expose metro-level geo the way a job posting does).

## What U15 must verify live

- Real yield of the query against actual GDELT coverage — is there enough
  PE-deal/expansion signal per 6h cron run (`jobs/run-detectors.ts`'s `0 */6 *
  * *` schedule) to be worth it, and does the boolean query need per-metro or
  per-vertical splitting to stay within GDELT's per-query `maxrecords` cap
  (250)?
- **Free-tier rate limits vs. the 6h cron cadence.** GDELT does not require a
  key for the DOC 2.0 endpoint and doesn't publish a hard, versioned quota for
  it, but documented community guidance asks callers to keep request cadence
  modest (informal guidance circulating from the GDELT Project: avoid tight
  retry loops, roughly on the order of one request every few seconds, not
  per-second bursts). A handful of queries every 6 hours is trivially within
  any reasonable reading of that guidance, but U15 must confirm current
  guidance on `gdeltproject.org` before scaling query count or frequency —
  this recon does not treat that number as verified.
- Actual field presence/nullability in production responses (this recon models
  the documented shape; live responses may omit `seendate`, `domain`, or
  `sourcecountry` more often than the fixture assumes — `normalizeArticleToCandidate`
  already treats all of these as optional and falls back to the injected
  clock when `seendate` is absent/unparseable).
- **Practice-name extraction accuracy** (`extractPracticeName` in
  `growth-events-classifier.ts`) is a bounded heuristic — it recognizes a
  fixed list of healthcare practice-type nouns as a name's trailing word(s)
  and walks backward over Title-Case words with a stoplist of common headline
  verbs. It will miss practice names that don't end in a recognized noun (e.g.
  a clinic named without any of the listed suffixes) and can misfire on
  unusual headline phrasing. U15 should validate this against a sample of real
  GDELT article titles before trusting `practiceHint` unattended — this is the
  most honest risk in this detector and the one most worth spot-checking
  first.
- If a paid news-API supplement (NewsAPI/Bing News) is added later to improve
  recall/freshness, its real per-request cost must replace a fabricated
  `unitCostUsd` before it goes live — `ctx.meter` (R19) is already wired at the
  detector level so adding a second source is a config change, not a rewrite.
