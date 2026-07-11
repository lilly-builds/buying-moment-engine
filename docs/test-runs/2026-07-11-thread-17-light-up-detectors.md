# Thread 17 — light up all three detector paths (2026-07-11)

## What changed
- Added a targeted cross-check stage so every already-qualified practice can query the other signal sources and stack real signals on the same practice.
- Fixed resolver drift that prevented stacking:
  - canonicalizes source-specific geo keys such as `austin-travis-county` to `austin-tx`;
  - strips listing-location tails such as `| Austin - North Austin` and `- Central` before name matching.
- Added Adzuna `where` support so staffing searches are scoped to the demo metro.
- Added a detector verification script for demo metros.

## Live verification against prod DB
Run target: Austin, TX.

Command:

```sh
pnpm dlx tsx scripts/run-detectors.ts --metro "Austin, TX" --cross-check-limit 0
```

Evidence:

- Adzuna was metered: `cost_events` provider `adzuna` increased to 27 rows, $0 unit cost.
- `raw_signals` now has `staffing_spike`: 21 rows.
- `signals` now has `staffing_spike`: 23 rows.
- The feed now has a real multi-kind lead:
  - `Texas Orthopedics` / Austin
  - 2 distinct signal kinds: `phone_complaints` + `staffing_spike`
  - feed rank check shows it above single-signal leads.

Top feed check after the run:

```txt
Texas Orthopedics · Austin · 2 signals · phone_complaints, staffing_spike
Memorial Women's Specialists · Houston · 1 signal · phone_complaints
Orthopedic Sports Clinic · Houston · 1 signal · phone_complaints
```

## GDELT status
The GDELT path is now wired into the detector run and cross-check stage, and calls are metered at $0. During live verification, GDELT repeatedly timed out / returned rate-limit errors from `api.gdeltproject.org`, so no honest `growth_events` row was emitted in this run. The code path remains error-isolated and does not fabricate a growth signal.

## Automated verification
- `pnpm typecheck` ✅
- `pnpm lint` ✅
- `pnpm test` ✅ — 86 passed, 1 skipped; 1064 passed, 6 skipped.

## Safety notes
- No outreach/send path touched.
- Cross-check is bounded to already-qualified practices, not every enumerated candidate.
- Every source call goes through the shared cost meter.
- Re-runs dedupe through existing `attachSignal` citation identity.
