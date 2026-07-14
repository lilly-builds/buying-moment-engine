# QA fix log (Thread 3, the discipline fix pass)

> Written by the fix thread after working both findings files. Methodology: superpowers
> systematic-debugging + test-driven-development + verification-before-completion. Every code
> change was test-first (red, then green) and verified with fresh command output. Zero em dashes.

## Branch and baseline handling

- Session opened on `feat/outreach-sent-state` with ~34 uncommitted files. That included mid-flight
  outreach work whose refactor of `sequence-setup-prompt.ts` was causing the only failing test
  (`connections.test.ts`). Per your call, that WIP was committed to its own feature branch first
  (`b75529b`), so the QA work starts from a clean base.
- All QA work is on a new branch **`qa/coverage-audit-fixes`**, cut from `main` (verified: every file
  the audit references is identical between `main` and the feature tip, so nothing was lost). 13
  commits, one per finding or coherent group.

## Before / after (fresh command output)

| Gate | Before (main baseline) | After (`qa/coverage-audit-fixes`) |
|---|---|---|
| `pnpm typecheck` | clean | **clean (exit 0)** |
| `pnpm lint` | clean on committed code (45 errors exist only in untracked throwaway `scripts/run-*` experiments, never committed, never in CI) | **clean on all tracked files** |
| `pnpm test` | 93 files green | **100 files, 1161 passed / 6 skipped, 0 failed** |
| coverage | unmeasured | **85.05% stmt / 77.06% br / 86.62% fn / 87.14% ln**, gated with floors 83/74/84/85 (gate exit 0) |
| `pnpm build` | passing (ungated in CI) | **success, and now gated in CI** |
| e2e | none | **4 Playwright smoke tests passed (14.2s)** |

~42 tests were added. New capabilities: a CI build gate, a coverage floor, a security-scanning
workflow, a React component-render harness, and a committed Playwright suite.

## Coverage audit (1-coverage-audit.md): 16 findings

**Fixed (11):** COV-01 (Playwright public smoke, verified live), COV-02 (CI build + coverage gate),
COV-03 (SCA + SAST + secret scan + Dependabot), COV-04 (SSRF guard, real vuln), COV-05 (login a11y +
render harness), COV-07 (release-readiness doc), COV-08 (qa-project-context + qa-strategy), COV-09
(DB constraint-enforcement tests), COV-10 (AI injection tests + prompt pinning), COV-11 (spec
reconciled to code), COV-13 (security headers).

**Partial (2):** COV-06 (health probe + louder cron failure done; Sentry/synthetic-monitoring
deferred), COV-15 (coverage measurement + KPIs landed; dashboard/quarantine-lane deferred).

**Deferred, with reason (3):**
- COV-12 (email inbox testing) needs a mail-capture service (Mailpit/Mailosaur) + live SMTP.
- COV-14 (contract testing) needs recorded real provider responses, which need live API keys/cost;
  hand-authored fixtures would be circular. Parsers already have hermetic unit tests.
- COV-16 (visual / cross-browser / chaos / AI-augmented QA / test-case mgmt) is correctly lower
  priority; visual + cross-browser now have their Playwright host and can follow cheaply.

## Live E2E (2-live-e2e.md): 4 findings

**Fixed (4):** E2E-02 (no "Measured" badge over a pending proof), E2E-03 (honest empty state on the
incumbent-tooling card), E2E-04 (route-name drift noted in the spec), and E2E-01 (below).

**E2E-01 — resolved 2026-07-14 after a product decision (Lilly chose Option 1).** The recommended
fix (drop `excludeDemoPractices` from the scoreboard) was correctly **not** applied: it would render
fabricated seed numbers as measured ROI, the exact D9 honesty violation the code deliberately
prevents. Lilly confirmed the empty board is correct because no real measured data flows through the
system yet. So the board stays honestly demo-excluded, and instead we fixed the real inconsistency,
test-first: (1) corrected the misleading seed docstring in `db/seed-demo.ts` (it no longer claims the
demo funnel fills the scoreboard), and (2) added an honest "no measured outcomes yet" note
(`ScoreboardEmptyNote` + a `hasMeasuredData` flag) so an empty board reads as intentional, not broken,
without ever showing seeded numbers as measured. Verified: 15 tests passed (new + E2E-02/03
regression), typecheck clean, eslint exit 0 on all changed files.

## What needs you (secrets / services / product calls)

These are the deferred halves, gated on a human decision per the session ground rules:
- **Secrets/env:** Sentry DSN (COV-06), the Supabase service-role key for the authed Playwright smoke
  and its CI job (COV-01), live API keys for contract tests and the AI CI eval (COV-14, COV-10).
- **Services:** a mail-capture tool (COV-12), an alert channel for the health probe (COV-06).
- **Product:** whether to build HubSpot webhook + feedback persistence (COV-11). The scoreboard
  demo-data honesty question (E2E-01) is now decided (Option 1) and closed.
