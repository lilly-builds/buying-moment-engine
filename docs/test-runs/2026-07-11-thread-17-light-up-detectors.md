# Thread 17 — light up all three detector paths (2026-07-11 / updated 2026-07-12)

## What changed
- Added a targeted cross-check stage so every already-qualified practice can query the other signal sources and stack real signals on the same practice.
- Fixed resolver drift that prevented stacking:
  - canonicalizes source-specific geo keys such as `austin-travis-county` to `austin-tx`;
  - strips listing-location tails such as `| Austin - North Austin` and `- Central` before name matching.
- Added Adzuna `where` support so staffing searches are scoped to the demo metro.
- Added a detector verification script for demo metros.
- Added a bounded GDELT GKG fallback when the GDELT DOC API rate-limits/timeouts. The article URL still comes from GDELT; the detector reads the publisher page title/description only to classify the GDELT-returned URL.
- Growth signals now carry an inferred feed vertical when source text clearly says dermatology, women’s health, orthopedics, or ophthalmology.

## Live verification against prod DB
Run target: Austin detector script with GDELT fallback enabled.

Command:

```sh
pnpm exec tsx scripts/run-detectors.ts --metro "Austin, TX" --cross-check-limit 0
```

Evidence after the run:

- `raw_signals` by detector kind:
  - `staffing_spike`: 24
  - `growth_events`: 8
- `signals` by kind:
  - `phone_complaints`: 26
  - `staffing_spike`: 26
  - `growth_events`: 8
- `cost_events` shows real source rows:
  - `adzuna`: 36 rows, `$0` unit cost
  - `gdelt`: 1 row, `$0` unit cost
- The feed now has all three signal kinds represented:
  - `Texas Orthopedics` — 2 signals: `phone_complaints`, `staffing_spike`
  - `Comprehensive Orthopaedics` — `growth_events`
  - `Sanford Health` — `growth_events`
  - `Aspire Women’s Health` — `growth_events`

Top feed check after the run:

```txt
Texas Orthopedics · orthopedics · 2 signals · phone_complaints, staffing_spike
Comprehensive Orthopaedics · orthopedics · 1 signal · growth_events
Sanford Health · dermatology · 1 signal · growth_events
Aspire Women’s Health · womens_health · 1 signal · growth_events
```

Example GDELT-returned growth article:

```txt
Sanford Health expands dermatology services in Spearfish
https://www.kotatv.com/2026/07/09/sanford-health-expands-dermatology-services-spearfish/
```

## Automated verification
- `pnpm typecheck` ✅
- `pnpm lint` ✅
- `pnpm test` ✅ — 86 passed, 1 skipped; 1066 passed, 6 skipped.

## Safety notes
- No outreach/send path touched.
- Cross-check is bounded to already-qualified practices, not every enumerated candidate.
- Every source call goes through the shared cost meter.
- Re-runs dedupe through existing raw-signal/citation identity.
