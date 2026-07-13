# Proactive Multi-Signal E2E Verification Prompt

Use this prompt when running the live/e2e verification for the proactive multi-signal cross-check wiring.

```md
We are testing the proactive multi-signal cross-check wiring in:

/Users/love/Developer/buying-moment-engine-proactive-cross-check

Goal:
Verify that the engine can find at least 1 real practice with 2+ fresh buying-moment signals after proactive cross-checking.

Definition:
A multi-signal practice = a real, non-demo, classified practice with at least 2 distinct fresh signal kinds, backed by evidence/citations.

Important files:
- jobs/run-engine.ts
- src/engine/cross-check.ts
- db/queries.ts
- scripts/run-detectors.ts
- app/api/cron/run-engine/route.ts
- db/schema/entities.ts
- db/migrations/0009_signal_checks.sql

Before live testing:
1. Confirm the new `signal_checks` migration has been applied to the target DB.
2. Confirm required env/API keys are present for:
   - DATABASE_URL
   - Adzuna
   - Google Places, if phone checks are expected
   - Anthropic, if discovery/classification is expected
   - PDL/brief keys only if brief generation is also being tested
3. Confirm we are not using demo/seed data for the success claim.

Suggested test sequence:
1. Run a bounded Austin live detector/cross-check run:
   ```bash
   ./node_modules/.bin/tsx scripts/run-detectors.ts --metro "Austin, TX" --cross-check-limit 10
   ```

2. Inspect `signal_checks` output:
   - Expect rows grouped by provider/kind/status.
   - Useful statuses:
     - `fired`
     - `checked_no_signal`
     - `skipped`
     - `errored`

3. Query for real practices with 2+ fresh distinct signal kinds.
   Verify:
   - practice is not demo data
   - vertical is classified
   - signals are fresh
   - each signal has evidence/source URL
   - at least one practice has 2+ distinct signal kinds

4. For the winning practice, capture:
   - practice id
   - practice name
   - city/state
   - signal kinds
   - source URLs/evidence snippets
   - whether any signal came from proactive cross-check
   - relevant `signal_checks` rows

5. If no multi-signal practice is found:
   - Do not call the test successful.
   - Report it as “no live multi-signal proof yet.”
   - Include counts for:
     - practices checked
     - signal checks fired
     - checked_no_signal
     - skipped
     - errored
   - Identify whether the issue is no source data, matching too strict, missing place IDs, API failure, or migration/env problem.

Success criteria:
- At least 1 real, non-demo, classified practice has 2+ fresh distinct signal kinds.
- Each signal has evidence/citation.
- `signal_checks` shows the cross-check audit trail.
- If a cross-check-added signal produced the second signal, explicitly call that out.

Do not claim success based only on tests, dry-run, seeded/demo data, or old stale signals.
```
