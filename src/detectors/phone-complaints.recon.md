# U4 source recon — phone-complaints reviews detector

Mandated first task per build-plan.md U4: pick the most cost-effective,
ToS-clean source with adequate data volume BEFORE writing detection logic.
Done as documentation (no live Google/Yelp API key available in this
environment).

## Candidates considered

| Source | Type | ToS basis | Volume for this use case |
|---|---|---|---|
| **Google Places API (Place Details)** | Official | Registered API key against Google's Places API; Google's [Terms](https://developers.google.com/maps/terms) permit displaying place data incl. reviews to end users, but explicitly bar pre-fetching, indexing, storing, or caching review CONTENT beyond a short display-only window — the only long-lived, storable field is `place_id` (plus derived, non-review metadata like our own verdict). Returns at most ~5 reviews per place (API-documented cap), sorted by relevance. | Every practice with a Google Business Profile has some review volume — near-universal coverage of the small independent healthcare/dental/vet practices that are EliseAI's actual buyer base. The ~5-review ceiling is thin but the source itself is close to universal. |
| Yelp Fusion API | Official, paid | Registered developer API; Yelp's [Fusion ToS](https://www.yelp.com/developers/api_terms) permit display of up to 3 review EXCERPTS (each truncated, typically ~160 chars) per business, similarly restricting redistribution/storage of full review text. | Good coverage in Yelp-heavy verticals, weaker for many independent healthcare/dental/vet practices with a thin or no Yelp presence relative to Google. Paid tier layers a per-call cost on top of an even smaller excerpt cap than Google. |
| Licensed review-data provider (e.g. a reputation-management/review-aggregation vendor with a redistribution license) | Paid, licensed fallback | A contracted license explicitly grants storage/redistribution rights for review text (exact terms vary by vendor) — NOT a scrape. | Best per-practice yield (full review history, not a 3-5-review cap) — the correct fallback once a practice's official-API yield is below the minimum-yield threshold below. Not modeled here (no contract/key in this environment); named as the U15 escalation path. |
| Direct review-page scraping | — | **Dropped.** Not an official/licensed source; excluded by the locked stack policy (official/licensed sources only), and both Google and Yelp explicitly prohibit scraping their review pages in their respective ToS. |

## Minimum-yield threshold

`GOOGLE_PLACES_MIN_YIELD_THRESHOLD = 3` (see `phone-complaints-google-places.ts`).
Below 3 retrievable reviews for a practice, a single detector run has too
small a sample to trust a phone-complaint verdict either way — a practice
could easily show 0-2 reviews with no phone mention purely by chance, not
because its phones are actually fine. The detector still processes whatever
Google returns below this floor (it degrades gracefully, it never throws) but
logs a warning so an operator/U15 knows that practice's Google yield is
inadequate and should be routed to the licensed-provider fallback instead of
trusted on Google alone.

## Decision: Google Places API — the source modeled/built here

Chosen as the ONE source built for this detector: it's the cleanest
single-endpoint model (one place-details call per already-known practice,
keyed by our own `place_id` for that practice — no ambiguous keyword-search
step, unlike U4's staffing-spike sibling which searches broadly across
unknown employers), it has near-universal small-practice coverage, and its
ToS constraint (never store review content) is a single, well-defined rule to
implement correctly rather than several thinner ones. Yelp Fusion's paid,
thinner, less-universal profile made it the secondary option; the licensed
provider is the escalation path once Google's ~5-review ceiling proves too
thin per-practice (see threshold above).

Modeled response shape (`GET /maps/api/place/details/json` with
`fields=place_id,name,url,reviews`):
```json
{
  "status": "OK",
  "result": {
    "place_id": "ChIJN1t_tDeuEmsRUsoyG83frY4",
    "name": "Sunshine Dermatology",
    "url": "https://maps.google.com/?cid=1234567890",
    "reviews": [
      {
        "author_name": "Jane D.",
        "rating": 1,
        "text": "I can't get through on the phone at all, and when I do I'm always on hold.",
        "relative_time_description": "a month ago",
        "time": 1719792000
      }
    ]
  }
}
```

Fields used: `result.reviews[].text` (classifier input, read IN-MEMORY ONLY —
never persisted, see the evidence-storage rule below); `result.place_id` (→
folded into the persisted `claim` string — the one identifier Google's ToS
permits storing long-lived); `result.url` (→ evidence `sourceUrl`, R5; falls
back to a constructed `https://www.google.com/maps/place/?q=place_id:<id>` URL
when Google omits it); `query.practiceHint` (→ `SignalCandidate.practiceHint`,
supplied by the caller — Google has no notion of "our customer," so the
orchestrator must pass in the known place_id/practiceHint pair per practice
rather than discover them via a search, the way staffing-spike does).

## Evidence-storage rule implemented (Google no-store-review-text rule)

`normalizePlaceReviewsToCandidate` in `phone-complaints-google-places.ts`:

- The classifier (`classifyPhoneComplaint`, pure, no I/O) reads each review's
  `text` IN-MEMORY to decide `isPhoneComplaint` + `confidence` + a
  CLOSED-VOCABULARY `category` label (e.g. `"long-hold"`, `"no-answer"`,
  `"cannot-get-through"`) — never a verbatim excerpt of the review.
- Each emitted `CandidateEvidence` atom's `claim` carries only the practice's
  `place_id` + our own `category` label + the words "Google review" — e.g.
  `Phone-access complaint detected in a Google review for place_id "ChIJ..."
  (category: "long-hold")`. No review text, no excerpt, ever.
- `snippet` is NEVER set on a Google-path atom. `candidateToRawSignals`
  (`src/engine/detector.ts`) only writes a `snippet` key into the persisted
  payload when the atom supplies one — omitting it here means the persisted
  row structurally cannot carry review content, not just "happens not to."
- Tests assert this directly: `tests/detectors/phone-complaints.test.ts` and
  `tests/detectors/phone-complaints-google-places.test.ts` both assert
  `atom.snippet` is `undefined` and that `claim` never contains the raw
  complaint text — only the place_id + category label.
- A hypothetical future licensed-provider path (not built here) would need its
  license to explicitly grant snippet storage before ITS evidence atoms
  populate `snippet` — that belongs in a new, separate adapter file, not a
  flag on this one, so the ToS-clean Google path can never silently regress.

## What U15 must verify live

- Real per-practice review yield against the `GOOGLE_PLACES_MIN_YIELD_THRESHOLD
  = 3` floor — how many EliseAI-relevant practices actually clear it on Google
  alone, and how many need the licensed-provider fallback.
- `GOOGLE_PLACES_API_KEY` must be provisioned as a real secret before
  `fetchGooglePlaceDetails` can succeed — it throws a clear error today when
  unset.
- Confirm `GOOGLE_PLACES_UNIT_COST_USD` (currently a `$0.005`/call placeholder
  modeled on the Places API "Atmosphere Data" SKU that includes reviews)
  against the actual billed tier before scaling query volume — every live
  call already routes through `ctx.meter` (R19), so this is a one-constant
  change, not a rewrite. Confirm Google's ~5-reviews-per-place cap still
  holds server-side (this recon models the documented shape; live responses
  may vary).
- Confirm the classifier's phrase list against real review language (this
  recon's fixture is synthetic; false negatives are possible for creatively
  worded complaints the closed phrase list doesn't cover — see
  `phone-complaints-classifier.ts`).
- Re-review Google's Places API Terms periodically — the no-store-review-text
  rule this detector honors is a point-in-time reading; ToS terms can change.
