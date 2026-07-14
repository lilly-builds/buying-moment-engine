# QA findings: 1 — Coverage audit (qa-skills)

> Written by: Thread 1, the `petrkindlmann/qa-skills` coverage audit (50 skills, 10 categories).
> Read and resolved by thread 3 (the fix thread).
> One writer per file: only this thread writes findings into it.
> Status legend: OPEN (default) · FIXED · DEFERRED · WONTFIX

## Summary
- Blockers: 0
- High: 4
- Medium: 8
- Low: 4
- Last updated: 2026-07-14 by Thread 3 (fix pass)
- **Resolution (Thread 3):** 16/16 worked. 11 FIXED, 2 PARTIAL (COV-06, COV-15), 3 DEFERRED
  (COV-12, COV-14, COV-16). Nothing OPEN. Deferred items and the secrets/services they need are
  listed in `3-fix-log.md`.

**Scope of this pass.** Breadth, not depth: "Am I missing a whole *category* of quality a real
team would expect before shipping?" Read-only. The repo tree was not clean at audit time (~34
uncommitted files, incl. `Untitled 2.rtf`, the `db/outreach.ts`/`db/schema/outreach.ts` WIP, the
`0010`/`0011` migration WIP, and this `dev-process/qa-review-prompts/` folder); nothing was
touched. Where a doc and the code disagreed, the code was trusted and the mismatch flagged
(see COV-11). Every finding cites a real file. Claims are tagged **[verified]** (I read the
code/config) or **[inferred]** (reasoned, not demonstrable from the repo alone).

**What is genuinely strong (so the go/no-go below is credible, not a gripe list).** Three areas
already clear a bar most production repos don't:
- **AI truth / citation-faithfulness testing** — the D2 "every claim links to its source"
  contract is enforced *and* tested to an unusual standard: verbatim-on-held-page snippet
  verification with word-boundary matching, planted-fabrication fixtures, positive controls, and
  a truth-gate that regenerates or refuses to persist a brief that cites a number the evidence
  never contained (`src/enrich/citations.ts`, `tests/enrich/citations.test.ts` (627 lines),
  `src/brief/synthesize.ts:16-35`).
- **Data-layer engineering** — idempotent `ON CONFLICT` ingestion, zod ingest-validation that
  quarantines malformed rows, and exact-math feed-ranking / per-vertical scoreboard tests
  (`db/ingest.ts`, `src/ingest/validate.ts`, `tests/db/feed-freshness.test.ts`,
  `tests/scoreboard/plumbing.test.ts`).
- **App-layer security** — AES-256-GCM-encrypted secrets at rest, a `proxy.ts` session+allowlist
  gate plus per-route `guardMutation()`, IDOR-safe server-side resolution, parameterized SQL, no
  XSS sink (`src/crm/token-crypto.ts`, `proxy.ts`, `src/lib/auth-guard.ts`).

The gaps below are almost all **breadth** gaps — whole testing disciplines that are absent — not
defects in what exists. Two exceptions are real code gaps the security lens surfaced (COV-04 SSRF,
COV-13 headers).

---

## Coverage map — 10 categories

| # | Category | Status | Evidence (what I actually saw) | Top gap → finding |
|---|----------|--------|--------------------------------|-------------------|
| 1 | **Foundation** | 🔴 Blind spot | No `.agents/qa-project-context.md` (the file every qa-skill reads first) — absent. No `qa-start` bootstrap. [verified] | COV-08 |
| 2 | **Strategy** | 🔴 Blind spot | No test-strategy / test-plan / risk-matrix doc anywhere in `docs/` [verified]. Mitigation: real *exploratory* evidence exists — dated manual verification runs in `docs/test-runs/` (e.g. `2026-07-11-e2e-d9-audit.md`). | COV-08 |
| 3 | **Automation** | 🟡 Partial | Unit/integration is **strong**: 93 Vitest files, real SQL via in-process PGlite (`tests/setup.ts`). API-handler tests for 7 sensitive routes. But **zero E2E / browser / UI-render tests** (no Playwright/Cypress, no `.spec.ts`), **no visual regression**, **no performance/load tests** — all absent from `package.json`. | COV-01, COV-02 |
| 4 | **Specialized** | 🟡 Partial (mixed) | database 🟡 & security 🟡 partial (strong core, real gaps). accessibility 🔴, email 🔴, analytics 🔴 blind. payment N/A. | COV-03/04/05/09/11/12/13 |
| 5 | **AI-augmented QA** | 🔴 Blind spot | No AI test-generation, bug-triage, ai-qa-review, or agentic-browser harness. Partial nod: flaky-test management is *evidenced* — `vitest.config.ts` documents a real hook-timeout flakiness fixed by `maxWorkers:4`. Low priority at this stage. | COV-15 |
| 6 | **Infrastructure** | 🟡 Partial | test-data-management **Covered** (synthetic factories, deterministic idempotent seeds). test-environments reasonable (PGlite, Vercel). CI exists but thin. contract-testing / service-virtualization **absent** (mocks are ad-hoc `vi.mock`/fetch-stub — no MSW/Pact). | COV-02, COV-14 |
| 7 | **Metrics** | 🔴 Blind spot | No code-coverage provider or config (`@vitest/coverage-*` not installed), no coverage gate/ratchet, no qa-metrics/dashboard. (NB: the `docs/test-runs/coverage-report-*` files are *contact-enrichment* coverage, not code coverage — naming collision.) [verified] | COV-02, COV-15 |
| 8 | **Process** | 🟡 Partial | shift-left **present** (`CLAUDE.md`/`AGENTS.md` guardrails, `dev-process/`, CI gates on push). Informal postmortems exist (`docs/test-runs/…-fix.md`). release-readiness **absent** (no go/no-go, smoke suite, rollback plan). compliance largely N/A (internal tool, no PII/PHI by design). | COV-07 |
| 9 | **Production & observability** | 🔴 Blind spot | No Sentry/OTel/error tracking, no `/health` route, no structured-log aggregation, no synthetic monitoring. The revenue-driving cron only `console.warn`s on failure (`app/api/cron/run-engine/route.ts:180-187`) — no alert. | COV-06 |
| 10 | **Knowledge & migration** | 🟡 Partial | ai-system-testing **Partial** (citation testing excellent; injection + CI-eval gaps). chaos-engineering absent (5 external APIs, resilience is coded but not fault-injection-tested). test-migration N/A (greenfield Vitest). | COV-10 |

Legend: 🟢 Covered · 🟡 Partial · 🔴 Blind spot.

---

## COV-01: No end-to-end / browser / UI-render tests on a product whose hero *is* a live UI
- **Severity:** high
- **Category / flow:** Automation (playwright-automation) — `/login`, `/` (feed), `/practice/[id]`, `/scoreboard`, `/integrations`, `/signals`
- **Where:** `package.json` (no `playwright`/`@playwright/test`/`cypress`/`@testing-library/react`); `find tests -name '*.spec.ts'` → 0; UI test files (`tests/ui/`, `tests/scoreboard/plumbing.test.ts`, `tests/design/tokens.test.ts`) assert *data-layer logic and token mapping*, never render a React component.
- **Evidence:** [verified] The test pyramid is "hourglass, top removed": 93 unit/integration files concentrated on the backend (`enrich` 20, `engine` 12, `crm` 12, `db` 8…) vs. UI: `tests/ui` 1, `tests/scoreboard` 1, `tests/design` 1 — none of which mount a component. `tests/scoreboard/plumbing.test.ts` imports `@/app/scoreboard/data` (the loader) and asserts aggregation math + demo-row exclusion — excellent, but it never renders `ScoreboardView`. Spec D5 makes the ranked feed the hero screen; nothing proves it renders, that a brief expands, that the sequence is editable inline (D7), or that login → feed → brief works as a journey.
- **What is wrong:** A UI regression (broken feed card, unpainted signal pill, dead CTA, layout break) ships invisibly. For a repo whose stated purpose is a demo-able live UI going to a job application, "no browser test at all" is the single most conspicuous missing category. This is exactly the surface Thread 2 (`webapp-testing`) will drive live — COV-01 is the standing gap that Thread 2's findings and a permanent Playwright suite should close.
- **Recommended fix:** Stand up Playwright (`playwright-automation`); start with a <5-min smoke of the 5 real pages (loads, no console errors, feed renders ≥1 card, brief expands, login form submits) per `release-readiness`'s smoke design; add `agentic-browser-testing` for exploratory journey coverage. Do **not** pad with throwaway assertions — cover the real journeys.
- **qa-skill that closes it:** `playwright-automation` (+ `agentic-browser-testing`, `release-readiness` for smoke selection)
- **Effort:** M
- **Status:** FIXED (public smoke committed + verified live); authed pages + CI wiring deferred (secret)
- **Resolution:** Stood up a real, committed Playwright suite (`@playwright/test`,
  `playwright.config.ts`, `e2e/smoke.spec.ts`, `pnpm test:e2e`) that boots the actual app (`next dev`,
  `PORT=` per the handoff's `-p` gotcha) and drives the public surface. **Verified live, 4 passed in
  14s:** login page renders the sign-in form, an unauthenticated protected route fails closed to
  `/login`, the COV-13 security headers are present on a real response, and the COV-06 `/api/health`
  probe is public and returns a valid status. So this also end-to-end-confirms COV-13 and COV-06.
  ```
  Running 4 tests using 4 workers
    ✓ security headers are present (COV-13, live)
    ✓ unauthenticated protected route fails closed to /login
    ✓ the health probe is public and returns a status (COV-06, live)
    ✓ login page renders the sign-in form
    4 passed (14.2s)
  ```
  Deferred (secrets/infra decision): the authed-journey smoke (feed renders ≥1 card, brief expands)
  needs the Supabase service-role key to mint a headless session, and gating this in CI needs env
  secrets + a DB in CI. The suite is the seam; wiring authed + CI is the human/secrets decision.
  Visual-regression and a11y-axe over all pages (COV-05/COV-16) now have their host and ride on this.

---

## COV-02: CI does not gate `build`, and code coverage is entirely unmeasured
- **Severity:** high
- **Category / flow:** Infrastructure (ci-cd-integration) + Metrics (coverage-analysis)
- **Where:** `.github/workflows/ci.yml` (steps: install → `pnpm typecheck` → `pnpm lint` → `pnpm test`); `vitest.config.ts` (no `coverage` block); `package.json` (no coverage provider).
- **Evidence:** [verified] Answering the prompt's explicit question — does `ci.yml` gate typecheck + lint + test + build? **typecheck ✅ · lint ✅ · test ✅ · build ❌.** There is no `pnpm build` step, so a change that typechecks and lints but breaks `next build` (server/client boundary error, static-generation failure, a bad dynamic import) merges green and only fails later on Vercel deploy. Separately, there is **no coverage measurement at all**: no `@vitest/coverage-v8`/`istanbul` dependency, no `coverage.thresholds` in `vitest.config.ts`, no ratchet — so "how much is tested" is unknown and undefended against regressions.
- **What is wrong:** The two cheapest, highest-signal CI gates a reviewer greps for are missing. A green CI badge currently does not mean the app builds. Also missing (secondary): no concurrency-cancel group, no artifact upload, no `actionlint`.
- **Recommended fix:** Add a `build` job (`pnpm build`) as a required check. Add `@vitest/coverage-v8` + a `coverage.thresholds` floor in `vitest.config.ts` so the runner exits non-zero below the floor (never scrape stdout — `ci-cd-integration` Core Principle 6); wire coverage-as-ratchet per `coverage-analysis`. Add `concurrency` + `cancel-in-progress`.
- **qa-skill that closes it:** `ci-cd-integration` (+ `coverage-analysis`)
- **Effort:** S
- **Status:** FIXED
- **Resolution:** `.github/workflows/ci.yml` now runs: typecheck → lint → **test:coverage** →
  **build**, plus a workflow-level `concurrency` (cancel-in-progress). Two gaps closed:
  - **Build gate:** added a `Build` step (`pnpm build`) so a change that typechecks/lints/tests but
    breaks `next build` fails CI instead of only failing later on Vercel. Verified `pnpm build` ✓
    (20/20 pages).
  - **Coverage gate:** installed `@vitest/coverage-v8`, added a scoped `coverage` block +
    `thresholds` in `vitest.config.ts`, and a `test:coverage` script wired into CI. Measured
    baseline (business logic `src`/`db`/`jobs`): **lines 87.1% · statements 85.0% · functions 86.6%
    · branches 77.0%**; floors set just under (85/83/84/74) as a ratchet. Proven the gate exits
    non-zero below floor (not a stdout scrape):
    ```
    $ vitest run <one file> --coverage --coverage.thresholds.lines=100
    ERROR: Coverage for lines (0.07%) does not meet global threshold (100%)
    EXIT_CODE=1
    ```
  Deferred (secondary, noted in the audit): `actionlint`, artifact upload. Security scanning is its
  own finding (COV-03).

---

## COV-03: No automated security scanning in CI (SCA / SAST / secret-scan / Dependabot)
- **Severity:** high
- **Category / flow:** Specialized (security-testing) + Infrastructure (ci-cd-integration)
- **Where:** `.github/workflows/ci.yml` (no `pnpm audit`/OSV/Semgrep/ZAP/TruffleHog); no `.github/dependabot.yml`; `eslint.config.mjs` (no `eslint-plugin-security`).
- **Evidence:** [verified — from the security probe] This app holds HubSpot **OAuth tokens** and BYOK **provider keys** (Anthropic/PDL), runs OAuth flows, and **scrapes third-party websites** — a high-value security surface — yet all five layers of the security-testing model (secret-scan, SCA, SAST, DAST, auth tests) are absent from CI. Positive: `pnpm-lock.yaml` is committed and CI installs `--frozen-lockfile` (dependency pinning is correct).
- **What is wrong:** A known-CVE transitive dependency or an accidentally-committed secret would ship unflagged. For a job application to an AI/healthcare-adjacent company, a security due-diligence pass on `ci.yml` finds nothing guarding the supply chain.
- **Recommended fix:** Add an OSV-Scanner (or `pnpm audit --audit-level=high`) job that fails on high/critical, a Semgrep `p/owasp-top-ten` job, a TruffleHog `--only-verified` secret scan, and a `dependabot.yml`. `security-testing` ships the ruleset (`references/scanning-and-ci.md`); `ci-cd-integration` wires it as a nightly/PR gate.
- **qa-skill that closes it:** `security-testing` (+ `ci-cd-integration`)
- **Effort:** M
- **Status:** FIXED
- **Resolution:** Added `.github/workflows/security.yml` (push + PR + weekly cron, concurrency-cancel)
  with three jobs and `.github/dependabot.yml`:
  - **SCA:** `pnpm audit --audit-level=high` (fails on high/critical). Verified locally: current tree
    has 2 moderate, 0 high/critical, so the gate is green today (`exit=0`).
  - **SAST:** Semgrep `p/owasp-top-ten`, token-less (`semgrep ci` with `SEMGREP_RULES`, no secret).
  - **Secret scan:** `gitleaks/gitleaks-action@v2` (uses the auto-provided `GITHUB_TOKEN`; a comment
    notes a private-org repo would also need `GITLEAKS_LICENSE`).
  - **Dependabot:** weekly npm (grouped minor/patch) + github-actions updates.
  No app secrets/env touched. Verified: both YAMLs parse; audit gate exit 0. Honest limit: the
  Semgrep and gitleaks *jobs* execute on the first push (GitHub Actions can't run locally here);
  their invocations follow each tool's standard token-less pattern. `eslint-plugin-security` skipped
  (would need tuning to avoid breaking the existing lint gate); Semgrep OWASP covers SAST.

---

## COV-04: SSRF — the scraper fetches DB-supplied URLs and follows redirects with no internal-address guard
- **Severity:** high
- **Category / flow:** Specialized (security-testing) — OWASP A06/A10 SSRF; engine enrichment path
- **Where:** `src/enrich/scrape.ts:125-129` (fetch with `redirect: "follow"`), `:291-301` (re-bases the crawl onto off-origin redirect targets); the only URL guard is a scheme allowlist at `src/enrich/page-parse.ts:248` (`http:`/`https:` only).
- **Evidence:** [verified code, inferred exploitability — from the security probe] The scraper fetches a `websiteUrl` sourced from the DB and follows off-origin redirects, but nothing blocks `http://169.254.169.254/` (cloud metadata / IMDS), `localhost`, or private ranges (`10./192.168./127.`). The scheme allowlist stops `file://` but not internal HTTP targets. Mitigating context: `websiteUrl` is DB-sourced (Google Places / discovery), not directly attacker-supplied over HTTP, and the engine is cron-gated — so exploitability is second-order. But on Vercel serverless the IMDS target is real, and there is no allow-list architecture as the checklist requires.
- **What is wrong:** A poisoned or maliciously-redirecting practice URL could make the server fetch internal metadata/endpoints. This is a genuine code vulnerability, not just a missing test.
- **Recommended fix:** Before every fetch (including each redirect hop), resolve the host and reject loopback/link-local/private IPs; or set `redirect: "manual"` and re-validate each hop against an allow-list. Add the SSRF negative-path test from `security-testing` (`references/owasp-tests.md`).
- **qa-skill that closes it:** `security-testing`
- **Effort:** M
- **Status:** FIXED
- **Resolution:** Root cause confirmed: `fetchOnce`/`fetchRobots` in `src/enrich/scrape.ts` called
  `fetch(url, { redirect: "follow" })` on DB-sourced URLs with the only guard a scheme allowlist —
  nothing blocked loopback / link-local / private / metadata targets, and `redirect: "follow"` hid
  every off-origin hop. Fixed test-first (TDD red→green):
  - New `src/enrich/url-guard.ts` with a pure, exhaustively-tested IP-range classifier
    (`isBlockedAddress`) covering IPv4 loopback/private/link-local/CGNAT/reserved and IPv6
    loopback/unspecified/link-local/ULA/IPv4-mapped, `assertFetchableUrl` (scheme + literal-host +
    optional DNS-resolution check), and `guardedFetch` which follows redirects **manually** and
    re-validates **every hop** before the request is made (blocks the public→169.254.169.254
    redirect vector, not just the response).
  - `scrape.ts` now routes both fetch sites through `guardedFetch`; `ScrapeDeps.lookup` (injected
    real DNS via `dnsLookupAll`) is wired at the production entry points (`app/api/cron/run-engine`
    and `scripts/run-pipeline.ts`), so a DB hostname whose A-record points inside is refused too.
    Literal-IP/`localhost` blocking is always on regardless of the resolver.
  - Tests: `tests/enrich/url-guard.test.ts` (14 cases incl. the metadata IP, the 172.15/172.16
    boundary, and a redirect-to-internal proof). Verified:
    ```
    tests/enrich/url-guard.test.ts  14 passed
    tests/enrich (scrape/robots/page-parse blast radius) + tests/engine  465 passed (33 files)
    pnpm typecheck  clean · eslint (changed files)  clean
    ```
  - Residual (documented, accepted): full DNS-rebinding immunity would need connect-time IP pinning;
    the injected-`fetch` architecture validates at the URL layer instead. Given DB-sourced,
    cron-gated inputs this matches the audit's second-order risk rating.

---

## COV-05: No accessibility testing on a real authenticated UI — and a real WCAG issue already slipped through
- **Severity:** medium
- **Category / flow:** Specialized (accessibility-testing) — all 6 UI routes
- **Where:** `package.json` (no `@axe-core/*`, no `jest-axe`, no Playwright to host axe); concrete defect at `app/login/login-form.tsx:71-73`.
- **Evidence:** [verified] Zero automated a11y tooling and zero documented manual a11y audit exist. The hand-authored markup is actually decent (`app/layout.tsx:56` sets `lang="en"`; the login form ties `<label htmlFor="email">` to the input, uses a real `<button type="submit">` and `required`), which is *why* this is a testing gap, not a rewrite. But the absence of any a11y check already let a real issue through: on a failed sign-in the error `<p>` (`login-form.tsx:71-73`) has no `role="alert"` and no `aria-describedby` linking it to the input, and focus never moves to it — a screen-reader user is never told the login failed (WCAG 3.3.1 / 4.1.3). axe catches only ~30-40% of issues, so keyboard + screen-reader passes are also needed.
- **What is wrong:** Nothing proves WCAG 2.2 AA conformance on a UI that a healthcare-focused reviewer will expect to be accessible; regressions are uncaught; one A/AA-level defect is already live.
- **Recommended fix:** Add `@axe-core/playwright` over all 6 pages + interactive states, plus a keyboard-nav spec and the manual checklist, gated in CI per `accessibility-testing`. Fix the login error announcement as the first concrete item.
- **qa-skill that closes it:** `accessibility-testing`
- **Effort:** M
- **Status:** FIXED (concrete defect + harness) — axe-over-all-pages folded into COV-01
- **Resolution:** Fixed the live WCAG defect test-first. `app/login/login-form.tsx`: the error `<p>`
  now has `id` + `role="alert"` (assertive live region, WCAG 4.1.3); the input gets
  `aria-invalid` + `aria-describedby` pointing at it (WCAG 3.3.1); and focus moves to the field on
  error so a keyboard/screen-reader user is not stranded. To test it I stood up the missing React
  render harness (`@testing-library/react` + `jsdom`; vitest include now matches `*.test.tsx`,
  jsdom via a per-file `@vitest-environment` docblock) — this closes the audit's "never renders a
  component" gap and unblocks all future component tests. Red→green verified
  (`findByRole("alert")` failed before the fix, passes after):
  ```
  tests/ui/login-form.test.tsx  2 passed  ·  typecheck clean · eslint clean
  ```
  Remaining a11y scope (axe over all 6 pages + keyboard-nav specs + manual checklist, gated in CI)
  rides on the Playwright suite — tracked under COV-01, not silently dropped.

---

## COV-06: No production observability or synthetic monitoring — the revenue-driving cron can fail silently
- **Severity:** medium
- **Category / flow:** Production & observability (observability-driven-testing + synthetic-monitoring)
- **Where:** `app/api/cron/run-engine/route.ts:180-187` (failure path is `console.warn` + a 500 JSON); no Sentry/OTel dependency; no `app/api/health` route (`find app -path '*health*'` → none).
- **Evidence:** [verified] The engine is one weekday Vercel-Cron heartbeat that fills the entire feed (spec D15). On failure the route only `console.warn("engine.run.setup_error", …)` to Vercel logs and returns 500 — there is no error tracker, no alert, and no synthetic probe watching the cron or the app. The spec itself concedes the scheduler "neither retries nor alerts" and relies on "self-heal next tick" — so a persistent failure (bad key, schema drift, provider outage) produces an empty/stale feed for days with nobody paged. There is an internal cost ledger (`db/cost-recorder.ts`) but that is spend accounting, not operational observability.
- **What is wrong:** This fails the "deploy in a real team" bar: the one background job that delivers the product's value has no failure signal reaching a human.
- **Recommended fix:** Add error tracking (Sentry) + a `/api/health` endpoint; emit a structured run-summary and alert on a failed/empty cron run; add a `synthetic-monitoring` probe on the cron result and the login→feed path with an alert threshold. Use `observability-driven-testing` to turn the first real prod error into a regression test.
- **qa-skill that closes it:** `observability-driven-testing` (+ `synthetic-monitoring`)
- **Effort:** M
- **Status:** PARTIAL — health probe + cron failure signal done; Sentry/synthetic-monitoring deferred (need a service/secret)
- **Resolution (done, no secrets):**
  - Added `app/api/health/route.ts` (+ `src/lib/health.ts`, pure/injectable, TDD): an
    unauthenticated liveness/readiness probe returning `{status, checks:{database}}`, 200 when the DB
    ping succeeds and 503 when it fails (never leaks the error). Added `/api/health` to the auth
    allowlist so a monitor can reach it in prod; it exposes only up/down, no row data. Tests:
    `tests/lib/health.test.ts` (3) + an auth-path case. Verified: 6 passed, typecheck + eslint clean.
  - Elevated the revenue cron's setup-failure from `console.warn` to `console.error` with a
    structured, timestamped payload (`app/api/cron/run-engine/route.ts`), so a log-based alert can
    key on it.
- **Deferred (needs a service/secret, the prompt's stop-and-ask gate):** Sentry error tracking (a DSN
  is a secret/env change), and a synthetic-monitoring probe wired to an alert channel. The `/health`
  route is the seam a monitor plugs into; the alert destination is the human decision.

---

## COV-07: No release-readiness process — no go/no-go, smoke suite, or rollback plan
- **Severity:** medium
- **Category / flow:** Process (release-readiness)
- **Where:** repo-wide — no `RELEASE-*.md`, no smoke-suite, no documented rollback thresholds; `docs/` has no go/no-go artifact.
- **Evidence:** [verified] "Ready to deploy in a real team" implies a repeatable release gate. None exists: no go/no-go checklist tied to evidence, no <5-min smoke suite (blocked anyway by COV-01), no baseline-relative rollback triggers, no staged-rollout plan. DB migrations are up-only with no rollback path (see COV-09) and this is undocumented as a recovery risk.
- **What is wrong:** Each deploy is "I think it's fine." A broken deploy has no practiced, timed recovery.
- **Recommended fix:** Adopt the `release-readiness` go/no-go checklist as a versioned artifact; define the smoke suite (rides on COV-01's Playwright), the rollback procedure (forward-fix, since migrations are irreversible), and post-deploy verification. See Appendix C below for the initial go/no-go call this audit produces.
- **qa-skill that closes it:** `release-readiness`
- **Effort:** S–M
- **Status:** FIXED
- **Resolution:** Added `docs/release-readiness.md`: a repeatable go/no-go checklist tied to
  evidence, the under-5-minute smoke-suite definition (rides on the Playwright suite, COV-01), the
  rollback procedure (forward-fix, since migrations are up-only), post-deploy verification, and the
  two-bar readiness call (send-with-application vs deploy-in-a-real-team) updated to reflect that
  COV-02/04/05/13 have landed. Verified: file present, zero em dashes, structure complete.

---

## COV-08: Foundation + Strategy artifacts absent — no qa-project-context, no test strategy, no risk matrix
- **Severity:** medium
- **Category / flow:** Foundation (qa-project-context) + Strategy (test-strategy, risk-based-testing)
- **Where:** no `.agents/qa-project-context.md` (dir absent); no strategy/plan/risk doc in `docs/`.
- **Evidence:** [verified] `.agents/qa-project-context.md` — the single file every qa-skill reads first — does not exist, so every downstream skill re-discovers the stack from scratch. There is no test-strategy doc (target pyramid, entry/exit criteria, quality gates, KPIs) and no risk matrix driving where to invest testing. This is the scaffolding that makes COV-01…07 coherent rather than a scattershot to-do list. Partial mitigation: documented exploratory runs in `docs/test-runs/`.
- **What is wrong:** No shared source of truth for QA scope, risk priority, or "done"; the highest-leverage step (a scored risk matrix) is missing.
- **Recommended fix:** Create `.agents/qa-project-context.md` (a filled draft is in **Appendix A** below — lift it verbatim), then produce a right-sized (startup-tier) `docs/qa-strategy.md` (essentials drafted in **Appendix B**) after running `risk-based-testing` to score the feature areas.
- **qa-skill that closes it:** `qa-project-context` → `risk-based-testing` → `test-strategy`
- **Effort:** S–M
- **Status:** FIXED
- **Resolution:** Created `.agents/qa-project-context.md` (the source-of-truth file QA tooling reads
  first: product, stack, test stack, CI/CD, environments, quality goals, the scored risk matrix,
  team, conventions) and `docs/qa-strategy.md` (startup-tier: target pyramid, PR/merge/deploy
  entry-exit gates, a named-threshold quality-gate table, KPIs). Both were reconciled against the
  live code, not the audit's snapshot: they document the now-gated CI (build + coverage + concurrency
  from COV-02) and the corrected coverage baseline (87.1/85.0/86.6/77.0, floors 85/83/84/74) rather
  than Appendix A's stale "no gates" claim. Verified: files present, zero em dashes, accurate to code.

---

## COV-09: Data-layer has no constraint-enforcement tests and only a shallow migration smoke test
- **Severity:** medium
- **Category / flow:** Specialized (database-testing)
- **Where:** `tests/db/migrations.test.ts:22-32` (SELECT-`[]` smoke over 7 of ~20 tables); no `information_schema` assertions; no `CREATE INDEX` in any of the 12 migrations; `db/migrations/meta/` is missing `0010_snapshot.json` and `_journal.json` idx 10 has an out-of-order `when` timestamp.
- **Evidence:** [verified — from the data-layer probe] The "immaculate data-engineering" guarantees (D13) live in constraints — provenance `NOT NULL` (`evidence.detected_at`, `signals.detected_at`), de-dup `UNIQUE` (`raw_signals.dedupe_hash`, `signals(practice_id,kind,evidence_id)`), provenance FKs — but **no test asserts any constraint actually rejects bad data**; the idempotency tests only exercise the `ON CONFLICT` happy path. The forward-migration test never checks columns/types/nullability, and no `drizzle-kit check` guards drift — drift the repo already exhibits (the `0010`/journal WIP; flagged, not judged). No index protects the `roi_events`/`cost_events` `practice_id` joins, and there is one N+1 in `practicesNeedingCrossChecks` (`db/queries.ts:764-799`, background path).
- **What is wrong:** A future migration could silently drop a NOT NULL/UNIQUE/FK guaranteeing provenance or de-dup and the suite would stay green — the data-integrity promises are untested at the DB level.
- **Recommended fix:** Add a constraint-rejection test (NOT NULL / UNIQUE / dangling-FK each rejects with the DB error), an `information_schema` assertion on the provenance-critical columns, a journal-consistency test, and `drizzle-kit check` in CI. Add indexes on `roi_events.practice_id` / `cost_events.practice_id` with one `EXPLAIN` teeth-test. Document the up-only/no-rollback recovery posture.
- **qa-skill that closes it:** `database-testing`
- **Effort:** M
- **Status:** FIXED (constraint-enforcement + information_schema); indexes/`drizzle-kit check` deferred
- **Resolution:** Added `tests/db/constraints.test.ts` (6 tests, real PGlite, raw SQL so it asserts on
  actual Postgres rejection, not Drizzle's compile-time types): provenance NOT NULL rejects
  (`signals.detected_at`, `evidence.detected_at`), de-dup UNIQUE rejects (`raw_signals.dedupe_hash`,
  `signals(practice_id,kind,evidence_id)`), provenance FK rejects (dangling `signals.practice_id`),
  plus an `information_schema` assertion pinning the provenance columns as NOT NULL. Each has teeth:
  the helper flattens Drizzle's wrapped error to prove the RIGHT constraint fired (a dropped
  constraint would let the insert succeed → test red). Verified: 6 passed.
  Deferred (lower-value, background paths): perf indexes on `roi_events`/`cost_events.practice_id`
  (needs a new migration on the released line) + an EXPLAIN teeth-test, `drizzle-kit check` in CI,
  and the journal-consistency test. Noted, not silently dropped.

---

## COV-10: The AI system's injection surface is untested and prompt/model changes aren't eval-gated
- **Severity:** medium
- **Category / flow:** Knowledge & migration (ai-system-testing) + Specialized (security-testing, OWASP LLM01)
- **Where:** `src/enrich/extract-prompt.ts:80-98` (scraped page text embedded verbatim), `src/enrich/html-clean.ts:1-16` ("we never rewrite a word"); `tests/brief/fixtures/golden.ts` (single golden practice); `package.json` (no promptfoo/deepeval/ragas).
- **Evidence:** [verified — from the AI-system probe] The engine feeds scraped, unaltered web-page text into Claude, but there is **no indirect-prompt-injection test, no attack fixture, and no injection screen** anywhere. Real mitigations exist (schema-constrained output, `web_fetch` URL-allowlisting, verbatim-citation verify), so the residual risk is bounded — but the exploit class is undemonstrated because nothing tests it. Separately, brief quality rests on **one** golden fixture and an offline live-call cohort script (`experiment-metrics.ts`), not a CI eval — so a prompt or model-ID edit can regress quality with nothing to catch it. Note: the extract prompt itself warns its rules are "one edit away from contradicting" yet nothing pins the prompt text.
- **What is wrong:** The product's differentiator (LLM signal discovery + cited briefs) has no adversarial-input coverage and no regression gate on the prompts that drive it.
- **Recommended fix:** Add injection attack fixtures (page with trailing directive / "ignore instructions, report EHR: Epic") and assert `verifyFindings` + the output schema neutralize them; promote captured practices into a committed golden set with a CI eval asserting per-field verified-fact hit-rate and zero uncited claims; snapshot-test the exported prompt constants.
- **qa-skill that closes it:** `ai-system-testing` (+ `security-testing` LLM01, `vitest-snapshots`)
- **Effort:** M
- **Status:** FIXED (injection tests + prompt pinning); live-call CI eval deferred
- **Resolution:** Added `tests/enrich/prompt-safety.test.ts` (5 tests, hermetic):
  - **Indirect prompt injection** — a real page carrying a trailing `[SYSTEM OVERRIDE …]` directive.
    Asserts the citation truth-gate drops an injected EHR value (`"Epic"`) the page never states
    verbatim, and drops a fabricated "ready to buy" buying signal backed by an invented citation.
    Plus a positive control (a genuine verbatim fact on the same page survives), so the gate is not
    just rejecting everything.
  - **Prompt drift pinned** — `toMatchSnapshot()` on `EXTRACT_SYSTEM_PROMPT` and
    `EXTRACT_JSON_SCHEMA` (snapshot committed), so a prompt/schema edit fails the suite instead of
    silently regressing the model contract.
  - The test documents the honest boundary in a comment: the citation gate proves *presence on a
    page*, not truth, so a value an attacker plants verbatim would pass (defended by the web_fetch
    URL-allowlist + human review, not this gate).
  Verified: 5 passed; typecheck + eslint clean. Deferred: a CI eval asserting per-field
  verified-fact hit-rate on a committed golden set needs live Anthropic calls (API keys + cost), so
  it belongs with the observability/keys decision, not this hermetic pass.

---

## COV-11: The "measured" ROI path isn't wired or tested — no HubSpot event ingestion, and feedback is a stub (doc↔code mismatch)
- **Severity:** medium
- **Category / flow:** Specialized (analytics-tracking-testing) + spec/code mismatch
- **Where:** `app/api/hubspot/` contains only `oauth`, `oauth/start`, `send-config` — **no webhook route** (`grep -rln webhook app/api` → none); `app/api/feedback/route.ts:8-13` returns `"feedback route stub — persistence lands in U9"`.
- **Evidence:** [verified] Spec D11/Stack says HubSpot "webhooks for open/click/reply events" feed the ROI scoreboard's **measured** numbers, and R13/D10 put AE 👍/👎 feedback in-scope. In the code: there is no webhook ingestion route, so no open/click/reply event is captured; and the feedback route is an auth-gated **stub** that persists nothing. So the scoreboard's engagement/feedback inputs currently have no ingestion path, and nothing tests that tracking data is captured correctly (event name/params/dedup) as `analytics-tracking-testing` requires. (The scoreboard honestly degrades to an all-zero board when unbacked — `tests/scoreboard/plumbing.test.ts` proves this — so it isn't *fabricating* numbers; the path is just not built/tested yet.)
- **What is wrong:** Two of the scoreboard's real-data inputs (email engagement, AE feedback) are unwired, and the code contradicts the spec, which claims them as shipped.
- **Recommended fix:** Decide honestly whether these are in-demo or parked; if in-demo, build the webhook ingestion + feedback persistence and cover them with `analytics-tracking-testing` contract assertions (event captured with correct shape, deduped) and an API test for `/api/feedback`. If parked, update the spec/README so doc and code agree.
- **qa-skill that closes it:** `analytics-tracking-testing` (+ `api-testing`)
- **Effort:** M
- **Status:** FIXED (doc reconciled to code); building the two inputs is a parked product decision
- **Resolution:** Confirmed the mismatch is real: no webhook route under `app/api/hubspot/`, and
  `app/api/feedback` persists nothing. Building them (HubSpot webhook ingestion needs app-side webhook
  config; feedback persistence is small but a product-behavior decision) is feature work, not a QA
  fix, so per the audit's own guidance I took the honest doc-reconciliation path: added a dated
  "Implementation status vs this spec" note to the top of `docs/spec.md` stating both inputs are
  specified-but-not-built and that the scoreboard's engagement/feedback columns therefore read
  honestly empty (not fabricated). Spec and code now agree. Whether to build them is surfaced as a
  product decision, not auto-actioned.

---

## COV-12: No email-flow testing — login is a magic link and the product's core action is an email send
- **Severity:** medium
- **Category / flow:** Specialized (email-testing)
- **Where:** `app/login/login-form.tsx:19` (`supabase.auth.signInWithOtp` magic link); send path `src/send/` + `app/api/send/route.ts` (HubSpot Sequence enrollment).
- **Evidence:** [verified] Authentication depends entirely on a magic-link email (`emailRedirectTo: …/auth/callback`), and the product's headline action is a 3-touch outreach **send**. The send *logic* is well unit-tested (`tests/send/*`, `tests/outreach/*`), but no test captures a real delivered email: not the login magic link (broken template/redirect = nobody can log in) and not the outreach send (wrong recipient / broken body / unsigned link). No inbox-capture tooling (Mailpit/Mailosaur) is present.
- **What is wrong:** The two email flows that gate access and deliver value have zero end-to-end/inbox verification; a template or redirect break is invisible until a human hits it.
- **Recommended fix:** Add an `email-testing` inbox-capture flow: assert the magic-link login email arrives, is addressed/templated correctly, and its link completes auth; and (in dev, key-gated) that an outreach send produces the expected body/recipient. Keep SPF/DKIM/DMARC deliverability in a separate non-blocking suite.
- **qa-skill that closes it:** `email-testing`
- **Effort:** M
- **Status:** DEFERRED
- **Resolution:** True value here is inbox-level verification (the magic-link email and the outreach
  send actually arrive, addressed/templated correctly), which needs a mail-capture service
  (Mailpit/Mailosaur) plus live SMTP, i.e. infrastructure and a service decision this hermetic pass
  cannot stand up. The send *logic* is already well unit-tested (`tests/send/*`, `tests/outreach/*`),
  and the magic-link `emailRedirectTo` is exercised by the COV-05 login test. Deferred with a clear
  plan: add a dev-only Mailpit capture flow asserting the login link completes auth and an outreach
  send produces the expected recipient/body; keep deliverability (SPF/DKIM/DMARC) in a separate
  non-blocking suite.

---

## COV-13: No HTTP security headers (CSP / HSTS / X-Frame-Options / nosniff)
- **Severity:** low
- **Category / flow:** Specialized (security-testing) — OWASP A02/A05
- **Where:** `next.config.ts` (empty config, no `async headers()`).
- **Evidence:** [verified — from the security probe] `next.config.ts` sets no response headers, so there is no CSP, HSTS, `X-Frame-Options: DENY`, or `X-Content-Type-Options: nosniff` — no clickjacking / MIME-sniff / defense-in-depth headers on an authenticated app.
- **What is wrong:** Standard hardening headers a reviewer expects on any deployed web app are absent.
- **Recommended fix:** Add an `async headers()` block to `next.config.ts` (HSTS, nosniff, frame-deny, a starter CSP) and a `security-testing` header assertion.
- **qa-skill that closes it:** `security-testing`
- **Effort:** S
- **Status:** FIXED
- **Resolution:** Added `src/lib/security-headers.ts` (`SECURITY_HEADERS`) and wired
  `async headers()` in `next.config.ts` to apply them to every route (`/(.*)`): HSTS
  (2y, includeSubDomains, preload), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy`, and a starter CSP
  (`base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'`). The CSP
  intentionally omits `script-src`/`default-src` — tightening those risks breaking the app's inline
  runtime and needs live Playwright verification (folded into COV-01). Tested first:
  `tests/lib/security-headers.test.ts` pins the policy AND that `next.config.headers()` returns it.
  Verified:
  ```
  tests/lib/security-headers.test.ts  7 passed
  pnpm build  ✓ (20/20 pages, config valid) · pnpm typecheck  clean · eslint  clean
  ```
  Follow-up: assert the live header on a response in the COV-01 smoke; add a nonce-based script-src CSP.

---

## COV-14: External-API contracts aren't tested and isolation is ad-hoc (mock-drift risk)
- **Severity:** low
- **Category / flow:** Infrastructure (contract-testing + service-virtualization)
- **Where:** `tests/enrich/research.test.ts`, `tests/enrich/pdl.test.ts` (fetch/global stubs); `tests/**` use `vi.mock` in ~4 files; no `msw`/`nock`/`pact` in `package.json`.
- **Evidence:** [verified] Good news first: no test hits a real external endpoint (`grep 'fetch(…https' tests` → none), so the suite is hermetic. But external dependencies (HubSpot, Anthropic, PDL, Adzuna, Google Places, GDELT) are faked ad-hoc per test with no shared contract fixture and no contract test pinning the real request/response shape. When a provider changes its envelope, the hand-built mocks stay green while production breaks — the exact failure `contract-testing` exists to prevent. (The AI probe flagged the same for the Anthropic Messages API: no contract test against a recorded real 200.)
- **What is wrong:** Mocks can drift from reality undetected; there's no single source of truth for each external contract.
- **Recommended fix:** Centralize external mocking with MSW (`service-virtualization`) and add a thin contract layer — one test per provider parsing a committed recorded real response through the production parser; optionally a nightly canary outside CI.
- **qa-skill that closes it:** `contract-testing` (+ `service-virtualization`)
- **Effort:** M
- **Status:** DEFERRED
- **Resolution:** A contract test only earns its keep when it parses a *recorded real* provider
  response, so it turns red when the real envelope drifts. Capturing those responses needs live API
  access (HubSpot/Anthropic/PDL/Adzuna/Google/GDELT keys + calls + cost), which is exactly the
  secrets/cost gate this pass stops at. Hand-authoring fixtures to match the parser would be circular
  (green by construction) and give false confidence. The parsers already have hermetic unit tests
  with fetch stubs. Deferred with the mechanism named: centralize mocking with MSW, then add one test
  per provider parsing a committed recorded 200 through the production parser, plus an optional
  nightly canary outside CI.

---

## COV-15: QA metrics / dashboards absent; test flakiness isn't tracked
- **Severity:** low
- **Category / flow:** Metrics (qa-metrics, qa-dashboard) + AI-augmented QA (test-reliability)
- **Where:** no metrics config/dashboard; `vitest.config.ts:hookTimeout/maxWorkers` comment documents a past flakiness episode.
- **Evidence:** [verified] There is no flakiness rate, defect-escape rate, MTTR, or pyramid-ratio tracking, and no dashboard. Flakiness is a *real* live concern here, not hypothetical: `vitest.config.ts` documents "26 and 33 failures across two consecutive full runs … all `Hook timed out`," fixed by capping `maxWorkers:4` — good engineering, but there's no ongoing flake-quarantine or trend tracking to catch the next occurrence.
- **What is wrong:** Quality trend is invisible; a creeping flake or coverage slide won't be noticed until it bites.
- **Recommended fix:** Once coverage exists (COV-02), track the `qa-metrics` core set from CI artifacts; add a `test-reliability` `@flaky` quarantine lane so a flake is visible and non-blocking rather than silently retried.
- **qa-skill that closes it:** `qa-metrics` (+ `test-reliability`, `qa-dashboard`)
- **Effort:** S
- **Status:** PARTIAL — measurement + KPIs landed; dashboard/quarantine-lane deferred
- **Resolution:** The precondition (coverage measurement) now exists and is gated (COV-02), and the
  KPI set (coverage floor + ratchet, flake < 2%, PR CI < 5 min, zero High security/a11y at release)
  is documented in `docs/qa-strategy.md` (COV-08). The existing flakiness episode is already
  mitigated and documented (`vitest.config.ts` `maxWorkers:4`). Deferred: a metrics dashboard and a
  formal `@flaky` quarantine lane that reads CI artifacts (needs CI-artifact plumbing, low value at
  solo/demo stage). Noted, not silently dropped.

---

## COV-16: Lower-priority category gaps, bundled (visual, cross-browser, chaos, AI-augmented QA, test-case mgmt)
- **Severity:** low
- **Category / flow:** Automation (visual, cross-browser) · Knowledge (chaos-engineering) · AI-augmented QA · Process (test-case-management)
- **Where:** `package.json` (no visual/cross-browser tooling); no chaos harness; no manual test-case repo.
- **Evidence:** [verified] For completeness of the map, these categories are absent but correctly *lower* priority at this stage: **visual-regression** (no Percy/Chromatic/Playwright screenshots — deferred until COV-01 lands, then cheap to add), **cross-browser** (no matrix — needs Playwright first), **chaos-engineering** (5 external APIs; resilience is *coded* — retries/timeouts/budgets per the AI probe — but not fault-injection-tested), **AI-augmented QA tooling** (ai-test-generation / ai-bug-triage / ai-qa-review not set up), **test-case-management** (no TestRail/Xray — fine for solo/demo). `test-migration` and `payment-testing` are **N/A** (greenfield Vitest; no payments).
- **What is wrong:** Nothing acute; these round out the coverage map and become relevant as the team/scale grows.
- **Recommended fix:** Sequence after the P0/P1 items: add visual + cross-browser on top of the Playwright suite (COV-01); add a chaos/fault-injection test for provider-outage handling; adopt AI-augmented QA skills as team process matures.
- **qa-skill that closes it:** `visual-testing`, `cross-browser-testing`, `chaos-engineering`, `ai-qa-review`/`ai-test-generation`, `test-case-management`
- **Effort:** M (spread across items)
- **Status:** DEFERRED (correctly lower priority, per the audit's own sequencing)
- **Resolution:** These are intentionally sequenced after the P0/P1 work. Visual-regression and
  cross-browser both ride on the Playwright suite (COV-01) and become cheap once it lands;
  chaos/fault-injection, AI-augmented QA tooling, and test-case management are stage-driven (relevant
  as team/scale grows, not at solo/demo). `test-migration` and `payment-testing` remain N/A. Deferred
  as a documented, prioritized backlog rather than padded with low-value work now.

---

# Appendix A — Filled `qa-project-context.md` (fulfils prompt step 1; lift verbatim into `.agents/`)

*Kept in this deliverable rather than written to `.agents/` to honour the read-only rule of this
pass. COV-08 recommends promoting it to `.agents/qa-project-context.md`.*

**Product.** GTM Maestro (Buying-Moment Engine) — an internal RevOps tool that hands an EliseAI
healthcare AE a live, ranked feed of practices hitting a buying moment, each with a verified,
source-cited, editable outreach brief. Type: internal SaaS / demo. URLs: Vercel preview + prod
(no public staging). Critical journeys: (1) magic-link login + email allowlist; (2) feed renders
ranked practices; (3) open a practice brief, verify a cited claim; (4) edit the 3-touch sequence;
(5) connect HubSpot (OAuth) + paste BYOK keys; (6) 👍/👎 feedback; (7) scoreboard reads
aggregate + per-vertical; (8) the weekday Vercel-Cron engine run fills the feed.

**Tech Stack.** Next.js 16 (app router; **Middleware is renamed Proxy** — `proxy.ts`), React 19,
TypeScript strict. Drizzle ORM + Postgres (Supabase, session pooler). Supabase Auth (magic link +
email allowlist). External: Anthropic (Haiku/Sonnet/Opus), People Data Labs, HubSpot (OAuth: CRM +
Sequences), Adzuna / Google Places / GDELT (signals). Hosting: Vercel (+ Vercel Cron). Tailwind v4.

**Test Stack.** Unit/integration: **Vitest 4** (`vitest.config.ts`), 93 files in `tests/`, real SQL
via in-process **PGlite** (`tests/setup.ts`). E2E: **None selected yet — Playwright recommended**
(default per qa-project-context Principle 3). Visual/perf/a11y: none.

**CI/CD.** GitHub Actions (`.github/workflows/ci.yml`) on push + PR: install → typecheck → lint →
test. **No build gate, no coverage gate, no artifacts, no concurrency control.** Deploy: Vercel.
Branch protection: not verifiable from the repo **[inferred: none configured]**.

**Environments.** Local (dev + PGlite tests), CI (ephemeral PGlite), Vercel preview + prod. No
long-lived staging; no seeded staging data described. Tests never hit real external APIs.

**Quality Goals** (proposed — none exist today; startup tier): unit/integration ≥60% on business
logic (COV-02 to measure); top-5 critical journeys under Playwright smoke; flake <2%; PR CI <5 min.

**Risk Areas** (Impact × Likelihood — feeds `risk-based-testing`):
| Area | Impact | Likelihood | Band | Note |
|---|---|---|---|---|
| Cron engine run (feed freshness) | 5 | 3 | CRIT | Silent failure = stale feed, no alert (COV-06) |
| LLM brief truth / citations | 5 | 2 | HIGH | Strongly tested; injection untested (COV-10) |
| Secrets / OAuth tokens / SSRF | 5 | 2 | HIGH | Encrypted; no scanning + SSRF hole (COV-03/04) |
| UI render / core journeys | 4 | 3 | HIGH | Zero browser tests (COV-01) |
| Data-layer integrity | 4 | 2 | MED | Strong; constraint-enforcement untested (COV-09) |

**Team.** Solo / effectively zero dedicated QA (dev owns all tests). Ownership model: devs own
tests; QA "role" = strategy + critical-path E2E, done by the dev. Methodology: the repo's
SCOPE→BUILD→VERIFY→REVIEW→SHIP spine (`CLAUDE.md`/`AGENTS.md`).

**Conventions.** Tests co-located under `tests/<domain>/*.test.ts`. Deterministic synthetic
fixtures/factories (no real-data cloning). No E2E selectors yet — when Playwright lands, prefer
`getByRole`/accessible-name selectors (they double as a11y assertions).

---

# Appendix B — Test strategy essentials this repo needs (fulfils prompt step 2)

Right-sized for a **startup-tier**, solo build (5 pages, not 50). Full doc → `docs/qa-strategy.md`
via `test-strategy` after `risk-based-testing`.

- **Target pyramid:** keep the strong unit/integration base; **add the missing top** — a small
  Playwright E2E smoke (5-8 critical journeys) and a handful of API-handler tests for `send`,
  `sequence`, `feedback`, `oauth/callback`. Do not invert into an ice-cream cone.
- **Entry/exit:** PR — typecheck+lint+unit+**build**+coverage-floor green (COV-02). Merge — +E2E
  smoke. Deploy — +full E2E, a11y scan, security scan; no open High findings from this file.
- **Quality gates:** PR gate (fast, blocking) · nightly gate (security scan, axe a11y, full suite —
  alert-only). Every gate names a threshold enforced in CI, not prose.
- **KPIs:** coverage floor + ratchet, flake <2% (COV-15), CI <5 min PR, zero High a11y/security
  violations at release.

---

# Appendix C — Release-readiness go/no-go (fulfils prompt step 5)

**Goal restated:** "ready to *send with a job application* AND *deploy in a real team*." These are
two different bars, so two calls:

**① Send with a job application → CONDITIONAL GO.** The build's *depth* is genuinely impressive
(AI truth-testing, data engineering, encrypted-secret auth) and worth showing. But a technical
reviewer will grep `ci.yml`, `package.json`, and the test tree — and the first things they'll
notice are the cheap, conspicuous breadth gaps. Close the P0 cheap-wins first so the strong core
isn't undercut: **COV-02** (CI build+coverage gate — S), **COV-03** (dependency/secret scanning — M),
**COV-04** (SSRF guard — M), a **COV-01** smoke subset (5-page Playwright load test — M), and the
one-line **COV-05** login-error fix. That converts "no E2E on a UI product / CI doesn't build / no
dep scanning" into "small but complete pyramid, gated CI, scanned supply chain" — which reads as
senior. Everything else can ship as a documented, prioritized backlog (this file *is* that backlog,
which itself reads well).

**② Deploy in a real team → NO-GO until:** COV-06 (observability + cron failure alerting), COV-07
(a go/no-go + rollback plan), and the COV-04/COV-13 security fixes land. A background job that can
fail silently and an app with no error tracking are not team-deployable regardless of how good the
unit tests are.

**Blocking bugs found this pass:** 0 (nothing is actively broken; SSRF COV-04 is the closest to a
live vulnerability). The gaps are missing *disciplines*, not failures in what exists.
