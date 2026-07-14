# QA project context: GTM Maestro (Buying-Moment Engine)

> This is the source-of-truth QA context file. Every qa-skill and QA tool reads it
> first, before doing anything else, so it does not have to rediscover the stack, the
> risks, or the conventions from scratch. Keep it current: if the code and this doc
> disagree, the code is the truth and this doc is the bug.

## Product

GTM Maestro (Buying-Moment Engine) is an internal RevOps tool that hands an EliseAI
healthcare AE a live, ranked feed of practices hitting a buying moment right now, each
with a verified, source-cited, editable outreach brief. Type: internal SaaS / demo.
URLs: Vercel preview and prod (no public staging).

Critical journeys:
1. Magic-link login and email allowlist.
2. Feed renders ranked practices.
3. Open a practice brief, verify a cited claim.
4. Edit the 3-touch sequence.
5. Connect HubSpot (OAuth) and paste BYOK keys.
6. Thumbs-up / thumbs-down lead-quality feedback.
7. Scoreboard reads aggregate and per-vertical.
8. The weekday Vercel-Cron engine run fills the feed.

## Tech Stack

Next.js 16 (app router; Middleware is renamed Proxy, `proxy.ts`), React 19, TypeScript
strict. Drizzle ORM and Postgres (Supabase, session pooler). Supabase Auth (magic link
and email allowlist). External: Anthropic (Haiku / Sonnet / Opus), People Data Labs,
HubSpot (OAuth: CRM and Sequences), Adzuna / Google Places / GDELT (signals). Hosting:
Vercel (with Vercel Cron). Tailwind v4.

## Test Stack

Unit / integration: Vitest 4 (`vitest.config.ts`), 93 files in `tests/`, real SQL via
in-process PGlite (`tests/setup.ts`). A component-render harness now exists too
(`@testing-library/react` and jsdom, selected per file via a `@vitest-environment`
docblock), so React components can be mounted and asserted; this landed with COV-05 and
closes the earlier "never renders a component" gap. E2E: none selected yet, Playwright
recommended (the default per qa-project-context Principle 3). Visual and performance:
none.

## CI/CD

GitHub Actions (`.github/workflows/ci.yml`) on push and PR. The pipeline is a single
`verify` job: install, then typecheck, then lint, then `test:coverage`, then build, with
a workflow-level `concurrency` group that cancels superseded runs. The build gate, the
coverage gate, and the concurrency control all landed under COV-02 (they were absent at
audit time).

- Build gate: `pnpm build` runs in CI, so a change that typechecks, lints, and tests
  green but breaks `next build` fails here instead of only later on the Vercel deploy.
- Coverage gate: `@vitest/coverage-v8` with a scoped `coverage` block and `thresholds`
  in `vitest.config.ts`, wired through the `test:coverage` script. Scope is the
  business-logic layers this suite owns (`src`, `db`, `jobs`); UI render coverage
  (`app/**`) is a different instrument (E2E, COV-01) and is deliberately not counted.
  Measured 2026-07-13 baseline: lines 87.1, statements 85.0, functions 86.6, branches
  77.0. Floors set just under, at 85 / 83 / 84 / 74 (lines / statements / functions /
  branches), as a ratchet: the runner exits non-zero below the floor.

Deploy: Vercel. Branch protection: not verifiable from the repo (inferred: none
configured). Still absent (secondary, tracked): security scanning in CI (COV-03),
`actionlint`, and artifact upload.

## Environments

Local (dev, and PGlite tests), CI (ephemeral PGlite), Vercel preview and prod. No
long-lived staging, and no seeded staging data described. Tests never hit real external
APIs.

## Quality Goals

Startup tier, right-sized for a solo, roughly 5-page build:
- Unit / integration coverage on business logic held at or above the CI floor
  (lines 85, statements 83, functions 84, branches 74), ratcheting up over time. This
  is now measured and gated (COV-02); it was a goal-to-measure at audit time.
- Top-5 critical journeys under a Playwright smoke (COV-01, forthcoming).
- Flake rate under 2%.
- PR CI under 5 minutes.

## Risk Areas

Impact times Likelihood, feeds `risk-based-testing`. This is the matrix the test
strategy (`docs/qa-strategy.md`) points back to.

| Area | Impact | Likelihood | Band | Note |
|---|---|---|---|---|
| Cron engine run (feed freshness) | 5 | 3 | CRIT | Silent failure means a stale feed with no alert (COV-06, open) |
| LLM brief truth / citations | 5 | 2 | HIGH | Strongly tested; injection surface untested (COV-10, open) |
| Secrets / OAuth tokens / SSRF | 5 | 2 | HIGH | Encrypted; SSRF now guarded (COV-04 done); dependency and secret scanning still open (COV-03) |
| UI render / core journeys | 4 | 3 | HIGH | Zero browser tests yet (COV-01, open) |
| Data-layer integrity | 4 | 2 | MED | Strong; constraint-enforcement untested (COV-09, open) |

Bands are inherent risk (Impact times Likelihood); a band does not drop just because a
fix landed, but the Note column tracks current mitigation status.

## Team

Solo, effectively zero dedicated QA (the dev owns all tests). Ownership model: devs own
tests; the QA "role" is strategy plus critical-path E2E, done by the dev. Methodology:
the repo's SCOPE, BUILD, VERIFY, REVIEW, SHIP spine (`CLAUDE.md` / `AGENTS.md`).

## Conventions

Tests are co-located under `tests/<domain>/*.test.ts`. Deterministic synthetic fixtures
and factories (no real-data cloning). No E2E selectors yet: when Playwright lands, prefer
`getByRole` and accessible-name selectors (they double as accessibility assertions).
