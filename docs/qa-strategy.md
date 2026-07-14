# QA strategy: GTM Maestro (Buying-Moment Engine)

**Doc type:** Test strategy (startup tier) · **Owner:** the dev (solo, no dedicated QA) · **Closes:** COV-08

This is the right-sized test strategy for this repo: a solo, startup-tier build of about
5 pages, not 50. It is deliberately not a 40-page enterprise quality-management system.
It says where testing investment goes, what "ready" means at each gate, which thresholds
are enforced in CI (not just described in prose), and how we measure whether quality is
holding.

Read the QA context first: `.agents/qa-project-context.md` holds the stack, the
environments, the team model, and the **risk matrix** that drives where this strategy
spends effort. Everything below aims at the CRIT and HIGH bands in that matrix.

## What has already landed

This strategy is written against a moving target; several audit gaps closed while it was
being written. As of this version:
- **CI build gate plus coverage floor (COV-02): done.** CI now runs install, then
  typecheck, then lint, then `test:coverage`, then build, with a concurrency group that
  cancels superseded runs. Coverage is scoped to the business-logic layers this suite
  owns (`src`, `db`, `jobs`); the 2026-07-13 measured baseline is lines 87.1, statements
  85.0, functions 86.6, branches 77.0, with CI floors set just under at 85 / 83 / 84 / 74
  (lines / statements / functions / branches). The runner exits non-zero below the floor,
  so it is a real ratchet, not a stdout scrape.
- **SSRF guard (COV-04): done.** The scraper now routes every fetch, and every redirect
  hop, through a URL guard that rejects loopback, link-local, private, and cloud-metadata
  targets.
- **Security headers (COV-13): done.** `next.config.ts` now sets HSTS, `nosniff`,
  frame-deny, a referrer policy, a permissions policy, and a starter CSP on every route.

## Target test pyramid

Keep the strong unit / integration base the repo already has, and add the missing top.
Do not invert this into an ice-cream cone (a few heavy manual or E2E checks sitting on a
thin unit base).

- **Base: unit / integration (broad, fast, already strong).** 93 Vitest files running
  real SQL via in-process PGlite. This is the foundation and it stays the foundation.
- **Middle: API-handler tests.** Keep and extend the handler tests on the sensitive
  routes. Add coverage for `send`, `sequence`, `feedback`, and `oauth/callback`.
- **Top: a small E2E smoke (COV-01, forthcoming).** A Playwright smoke of 5 to 8
  critical journeys (login to feed to brief to editing the sequence, plus the scoreboard
  and integrations pages loading clean). Small and real, never padded with throwaway
  assertions.

Component-render tests (`@testing-library/react` and jsdom) sit between the middle and
the top; the harness landed with COV-05 and is available for component-level assertions
without a full browser.

## Entry and exit criteria (the gates)

Three gates, each tighter than the last. Every criterion is a pass/fail check, not a
judgement call.

**PR gate (fast, blocking, runs on every push and PR).**
- typecheck passes.
- lint passes.
- unit and integration tests pass.
- coverage is at or above the floor (85 / 83 / 84 / 74). Below the floor, CI exits
  non-zero.
- `next build` succeeds.

**Merge gate (before merging to the main branch).**
- Everything in the PR gate, plus:
- the E2E smoke is green (rides on COV-01 once the Playwright suite lands).
- no unresolved High-severity finding from the coverage audit
  (`dev-process/qa-review-prompts/findings/1-coverage-audit.md`) has been reintroduced.

**Deploy gate (before shipping to prod).**
- Everything in the merge gate, plus:
- the full E2E suite is green.
- an accessibility scan (axe over the UI routes) shows zero High violations.
- a security scan (dependency and secret scan, COV-03) shows zero High or Critical
  findings.
- the release-readiness go/no-go (`docs/release-readiness.md`) is a GO.

## Quality gates with named thresholds

Every gate names a number enforced in CI, never left as prose.

| Gate | When | Threshold (enforced) | Blocking? |
|---|---|---|---|
| Typecheck | PR | zero TS errors | yes |
| Lint | PR | zero lint errors | yes |
| Coverage floor | PR | lines at or above 85, statements 83, functions 84, branches 74 (src, db, jobs) | yes |
| Build | PR | `next build` exits 0 | yes |
| E2E smoke | merge | all smoke journeys pass | yes (once COV-01 lands) |
| Accessibility | nightly and deploy | zero High axe violations | alert-only nightly, blocking at deploy |
| Security scan | nightly and deploy | zero High or Critical (SCA and secret scan) | alert-only nightly, blocking at deploy |
| Full E2E | deploy | all journeys pass | yes |

The split is deliberate: the PR gate is fast and blocking so day-to-day work is not
slowed, while the heavier scans (axe, security) run nightly as alert-only and harden into
blocking checks at the deploy gate.

## KPIs

Track the trend, not just the point-in-time pass. Now that coverage exists (COV-02), wire
these off CI artifacts.

- **Coverage floor plus ratchet.** Never below the floor; raise the floor as coverage
  climbs, and never lower it silently.
- **Flake rate under 2%** (COV-15). A `@flaky` quarantine lane keeps a flake visible and
  non-blocking rather than silently retried.
- **PR CI under 5 minutes.** The fast gate stays fast.
- **Zero High accessibility or security violations at release.**

## Out of scope for this tier (documented, not built)

Right-sizing means naming what we are intentionally not doing yet: visual regression,
cross-browser matrices, chaos and fault-injection, contract tests against recorded
provider responses, and QA dashboards. These become relevant as the team and scale grow;
they are tracked in the coverage audit (COV-14, COV-15, COV-16) and sequenced after the
Playwright suite (COV-01) lands.
