# Data Signal System

This is the core engine behind GTM Maestro: it watches public business sources for timing signals, resolves those signals onto practices, and ranks the feed by how many fresh signals are firing.

The product thesis is not “find clinics that fit an ICP.” It is:

> Find healthcare practices where something is happening right now that makes patient communication/front-desk automation more urgent.

## The three live signal families

| Signal family | Stored kind | Source | What it means |
|---|---|---|---|
| Phone complaints | `phone_complaints` | Google Places / Maps reviews via the discovery path | Patients publicly complain about phones, scheduling, hold times, or access friction. |
| Staffing spike | `staffing_spike` | Adzuna job listings | The practice is hiring front-desk, receptionist, scheduler, patient-access, or call-center roles. |
| Growth events | `growth_events` | GDELT news metadata / GKG feed | The practice is expanding, opening a facility/location, adding services/providers, merging, or otherwise growing. |

All three are public business signals. None of the signal paths store patient data or PHI.

## End-to-end flow

```txt
Public source
  ↓
Fetcher / source adapter
  ↓
Classifier / normalizer
  ↓
Raw signal row
  ↓
Practice resolver
  ↓
Evidence + signal rows
  ↓
Feed ranking + brief generation
```

The important tables are:

- `raw_signals` — source-normalized detector output before promotion.
- `practices` — deduped practice entities.
- `evidence` — source URL, supporting snippet when allowed, confidence, and detection timestamp.
- `signals` — fired signal rows attached to practices.
- `cost_events` — metered source calls.
- `discovery_candidates` — Google Places archive/cache for enumerated places and review verdicts.

## Source-specific behavior

### Google Places / phone complaints

Google Places currently acts as the anchor discovery source for demo metros.

The discovery path:

1. Searches Google Places by ICP category and metro.
2. Applies a rating/review-count funnel to avoid wasting expensive checks.
3. Pulls details/reviews for candidates that pass the funnel.
4. Classifies review text in memory for phone/scheduling/access complaints.
5. Stores only the Google Maps URL and derived complaint category/confidence, not review text.
6. Resolves the practice and attaches a `phone_complaints` signal.

The standalone phone-complaint detector still exists as a targeted per-place lookup. It is useful when another source finds a practice first and the system already has or resolves a `place_id`.

### Adzuna / staffing spike

Adzuna finds job listings that indicate front-desk pressure.

Key implementation details:

- Searches are metro-scoped with Adzuna's `where` parameter, such as `Austin, TX`.
- Queries use practical job-search terms like `medical receptionist`, `front desk medical`, `patient coordinator`, `medical scheduler`, and `call center medical`.
- The classifier rejects clinical roles like nurse, medical assistant, hygienist, etc.
- Cross-check mode can query by exact practice name and metro.
- Adzuna sometimes lists a parent company as employer while the job title names the clinic. In targeted cross-checks, the title/description can confirm the known practice so the signal attaches to the correct practice rather than creating a parent-company orphan.

### GDELT / growth events

GDELT finds public news articles about growth events.

The primary path uses the GDELT DOC API. Because that API can rate-limit or timeout, the detector also has a bounded fallback over GDELT GKG files.

GKG means **Global Knowledge Graph**. It is GDELT's raw article metadata feed.

The fallback works like this:

1. Read a bounded recent slice of GDELT GKG file URLs from the public master file list.
2. Scan those GKG records for healthcare + growth-shaped article URLs.
3. For each likely URL, read the publisher page title/description.
4. Classify whether the GDELT-returned URL is truly a growth event.
5. Attach a cited `growth_events` signal when the article names a practice and describes a real expansion/merger/provider/location event.

The article URL still comes from GDELT. The publisher page is read only to classify and extract the human-readable title/description for the GDELT-returned article.

## Practice resolution and deduplication

Signals only become useful when they attach to the correct practice.

The resolver uses:

1. normalized geography;
2. cleaned practice-name similarity;
3. source-specific hints from targeted cross-checks.

Known demo geo variants are normalized, for example:

```txt
austin-travis-county -> austin-tx
houston-harris-county -> houston-tx
```

Name matching also strips location tails such as:

```txt
Sanova Dermatology | Austin - North Austin -> Sanova Dermatology
Austin Retina Associates - Central -> Austin Retina Associates
```

This prevents source formatting differences from creating duplicate practices.

Important limitation: GDELT often provides only country-level geography. For GDELT, targeted exact-name matching and article text are more reliable than geo equality alone.

## Cross-checking

There are two ways signals land:

### Discovery mode

A source independently finds a practice.

Examples:

- Google Places finds a clinic with phone complaints.
- Adzuna finds a clinic hiring medical receptionists.
- GDELT finds a practice expanding services.

### Targeted cross-check mode

A practice is already known, and the engine asks other sources whether they have corroborating evidence.

Examples:

- Google Places finds Texas Orthopedics.
- The cross-check asks Adzuna whether Texas Orthopedics is hiring patient-access/front-desk roles.
- The cross-check asks GDELT whether Texas Orthopedics has growth news.

This is how multi-signal leads should be built: one fired signal opens an investigation window, and other sources are checked for that same practice.

## Ranking

The feed ranks by distinct fresh signal kinds, not by evidence-row count.

Examples:

- Three job postings = one `staffing_spike` kind.
- Phone complaints + staffing spike = two signal kinds.
- Phone complaints + staffing spike + growth event = three signal kinds.

A practice with two fresh signal kinds outranks a practice with one fresh signal kind. Freshness breaks ties.

## Cost and safety rules

- Every paid or source call routes through the cost meter and writes `cost_events`.
- Cross-checking is bounded to qualified/known practices, not every enumerated candidate.
- Re-runs dedupe via raw-signal hashes and citation identity.
- Google review text is classified in memory and not persisted.
- No signal path sends messages or contacts practices.
- The send/outreach path remains separately gated.

## Current live proof point

The live database has all three signal kinds represented:

- `phone_complaints`
- `staffing_spike`
- `growth_events`

Examples from the post-fix verification:

- Texas Orthopedics: `phone_complaints` + `staffing_spike`
- Comprehensive Orthopaedics: `growth_events`
- Sanford Health: `growth_events`
- Aspire Women’s Health: `growth_events`

See `docs/test-runs/2026-07-11-thread-17-light-up-detectors.md` for the live verification record.

## Next architecture step

The next major improvement is to make cross-checking a first-class auditable system, not just a signal attachment step.

Recommended follow-up: add a `signal_checks` concept/table that records:

```txt
practice_id
signal_kind
status: fired | checked_no_signal | errored | skipped
source/provider
checked_at
evidence_id nullable
reason nullable
```

That would let the system distinguish “we checked GDELT and found no growth signal” from “we never checked GDELT,” which is critical for trust, cost discipline, and debugging.
