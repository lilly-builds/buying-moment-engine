# Proactive signal cross-check — Austin verification prep

**Date:** 2026-07-13  
**Branch:** `feat/proactive-signal-cross-check`  
**Scope:** Thread 08 proactive multi-signal cross-checking for Austin.

## Verdict

Dry-run verification passed. The live Austin run was **not executed** in this worktree because the new `signal_checks` migration must be applied to the target database before the live script can write audit/cache rows, and this worktree does not carry live `.env.local` credentials.

No multi-signal lead is claimed in this note.

## Dry-run command

```bash
./node_modules/.bin/tsx scripts/run-detectors.ts --dry-run --metro "Austin, TX"
```

## Dry-run output summary

- Metro: Austin, TX
- Planned Adzuna calls: 9
- Planned GDELT calls: 1
- Google phone detector: broad run skipped; phone checks happen via discovery/cross-check by known `place_id`
- Network calls: 0
- Writes: 0
- Cost: $0.0000

## Live-run command after migration

```bash
./node_modules/.bin/tsx scripts/run-detectors.ts --metro "Austin, TX" --cross-check-limit 10
```

Before running live:

1. Apply `db/migrations/0009_signal_checks.sql` to the target DB.
2. Confirm `DATABASE_URL`, `ADZUNA_APP_ID`, and `ADZUNA_APP_KEY` are present.
3. Confirm Google Places credentials are present if phone cross-checks should run by `place_id`.
4. Keep `--cross-check-limit` small for the first run.

## What the live run must report

The script now prints:

- `raw_signals` by kind
- `signals` by kind
- `cost_events` by provider
- `signal_checks` by provider, kind, and status
- multi-kind practices with `count(distinct signals.kind) >= 2`
- cost rows recorded during the script invocation

## D9 / R19 check

- No clinic is contacted.
- No outreach sends.
- Google review text is not persisted by the cross-check path.
- Cross-check source calls are metered through `cost_events` with the resolved `practiceId`.
- `signal_checks` records fired, checked-empty, skipped, and errored source coverage separately from fired `signals`.
