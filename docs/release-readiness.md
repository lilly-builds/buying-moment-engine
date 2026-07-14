# Release readiness: GTM Maestro (Buying-Moment Engine)

**Doc type:** Release go/no-go artifact (repeatable) · **Closes:** COV-07

This is the repeatable release gate for the tool. Run it before every deploy. It turns
"I think it's fine" into a checklist tied to evidence, a defined smoke suite, a practiced
recovery path, and a set of post-deploy checks. Copy the go/no-go table into the release
notes for each ship and fill the Evidence column with a link or a command output, never a
bare "looks fine."

Read `docs/qa-strategy.md` for the gates this sits on top of, and
`.agents/qa-project-context.md` for the risk matrix.

## Go / no-go checklist (tie every row to evidence)

A release is GO only when every blocking row is GO with real evidence attached. A NO-GO
on any blocking row stops the release.

| # | Check | Evidence required | Blocking? | Status |
|---|---|---|---|---|
| 1 | CI green on the release commit (typecheck, lint, test:coverage, build) | link to the green CI run | yes | |
| 2 | Coverage at or above floor (85 / 83 / 84 / 74) | the `test:coverage` summary | yes | |
| 3 | `next build` succeeds (20/20 pages) | build log | yes | |
| 4 | Smoke suite green (see below) | Playwright run link (COV-01) | yes, once COV-01 lands | |
| 5 | No open High-severity audit finding regressed | the coverage-audit file status | yes | |
| 6 | Security headers present on a live response | curl of the deployed URL headers (COV-13) | yes | |
| 7 | Secrets not committed, and env vars set in Vercel | secret-scan output (COV-03) and Vercel env check | yes | |
| 8 | DB migrations reviewed and forward-only (no destructive drop of a provenance or de-dup constraint) | migration diff review | yes | |
| 9 | Cron `CRON_SECRET` set and the engine route is fail-closed | env check | yes | |
| 10 | Rollback / forward-fix path understood for this change | this doc acknowledged | yes | |

## Smoke suite (under 5 minutes)

The smoke suite rides on the forthcoming Playwright suite (COV-01); until that lands, run
it manually against the preview deploy. It is the fastest proof the app is alive and the
core journey works, not a full regression.

Cover the 5 real pages plus the core journey:
1. `/login` loads, the form submits, and there are no console errors.
2. `/` (the feed) loads and renders at least one ranked practice card.
3. A brief expands from a feed card and shows a source-linked claim.
4. The 3-touch sequence is editable inline.
5. `/scoreboard` loads and renders aggregate and per-vertical without error.
6. `/integrations` loads and shows the HubSpot connect plus the BYOK key state.
7. Assert a security header (for example `X-Frame-Options: DENY`) is present on a
   response (COV-13), and that no page logs a console error.

Pass criteria: every step passes, zero console errors, and the smoke completes in under
5 minutes.

## Rollback procedure (forward-fix, because migrations are up-only)

Read this before shipping: **there is no down-migration path.** DB migrations in this
repo are up-only (COV-09), so recovery is forward-fix, not rollback. Reverting the app
code alone can leave it running against a schema that has already moved forward.

1. **App-only regression (no migration in the release): revert the deploy.** Roll the
   Vercel deployment back to the previous good build. This is safe precisely because the
   schema did not change.
2. **Regression involving a migration: forward-fix, do not try to un-migrate.** Ship a
   new migration that corrects the state, plus a code fix on top of it. Never hand-edit a
   past migration or attempt a destructive down step; that risks the provenance and
   de-dup guarantees the data layer depends on (D13).
3. **If the engine cron is the problem: it self-heals next tick.** The run is idempotent,
   reconciliation-based, and bounded per run, so a bad or partial run is corrected on the
   next weekday heartbeat once the cause is fixed. Until COV-06 lands there is no alert,
   so a human must watch the feed after any risky cron-touching release.
4. **Always keep the previous good deployment pinned** until post-deploy verification
   passes, so option 1 is available instantly.

## Post-deploy verification

After the deploy goes live, and before calling it done:
1. Rerun the smoke suite against the production URL.
2. Confirm a security header is present on a live production response (COV-13).
3. Trigger or wait for one engine cron run and confirm the feed fills. The run returns a
   structured summary; confirm it did not return a 500. This is the CRIT-band risk in the
   matrix.
4. Open one brief and confirm a cited claim still links to its source.
5. Confirm login works end to end (the magic link arrives and completes auth) on the live
   deploy.

## The two-bar readiness call

The original goal was two different bars, so it takes two calls. This section updates the
audit's Appendix C to reflect the fixes that have since landed: COV-02, COV-04, COV-05,
and COV-13 are now DONE.

**① Send with a job application: GO (was conditional).** The build's depth was always the
strong part (AI truth-testing, data engineering, encrypted-secret auth). The conspicuous
breadth gaps a technical reviewer greps for are now largely closed:
- COV-02 (CI build plus coverage gate): DONE.
- COV-04 (SSRF guard): DONE.
- COV-05 (login-error accessibility fix plus a component-render harness): DONE.
- COV-13 (HTTP security headers): DONE.

What remains before a fully clean story is COV-03 (dependency and secret scanning in CI)
and a COV-01 smoke subset (a 5-page Playwright load test). With those two, the picture is
"small but complete pyramid, gated CI, guarded supply chain," which reads as senior.
Everything else ships as a documented, prioritized backlog, and that backlog (the coverage
audit) itself reads well.

**② Deploy in a real team: NO-GO until COV-06 lands.** Two of the three original blockers
are now cleared: the COV-04 and COV-13 security fixes are DONE, and COV-07 (a go/no-go
plus rollback plan) is satisfied by this very artifact. The remaining blocker is
**COV-06** (production observability plus cron-failure alerting). A background job that
delivers the product's entire value and can fail silently, on an app with no error
tracking, is not team-deployable regardless of how good the unit tests are. Close COV-06
and this bar flips to GO.

**Blocking bugs outstanding: 0.** Nothing is actively broken. The remaining items are
missing disciplines (scanning, observability, the browser smoke), not defects in what
exists.
