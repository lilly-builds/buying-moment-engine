# QA findings: 2 — Live end-to-end test (webapp-testing)

> Written by: Prompt 2 / `webapp-testing` thread (native Python Playwright, headless chromium,
> driven black-box against a real dev server). Read and resolved by thread 3 (the fix thread).
> One writer per file: only this thread writes findings here.
> Status legend: OPEN (default) · FIXED · DEFERRED · WONTFIX

## Summary
- Blockers: 0
- High: 1
- Medium: 2
- Low: 1
- Last updated: 2026-07-13 by the webapp-testing thread

### How this pass was run (so thread 3 can reproduce)
- **App:** `next dev` (Next 16.2.10, Turbopack) on **:3100** (`env PORT=3100 pnpm dev` — the
  handoff's `pnpm dev -- -p 3100` fails; this Next parses `-p` as a directory. Use `PORT=`).
  A dev server for another repo was already on :3200; left untouched.
- **DB:** the real Supabase Postgres from `.env.local`. It already held real data
  (54 practices, 63 signals, 28 briefs) so the feed/brief flows had data with no seed.
  I then ran **`pnpm db:seed`** (idempotent, non-destructive, `demo:`-scoped) because the
  **scoreboard** flow needs funnel data — see **E2E-01** for what that revealed.
- **Auth:** Supabase magic-link (PKCE). Headless login was minted by generating a magic-link
  token with the service-role key and `verifyOtp` through the app's own `@supabase/ssr`
  server client, so the session cookie is byte-for-byte what `proxy.ts` reads back. Logged in
  as the allowlisted `hello@opterraventures.com`.
- **Tooling:** Playwright 1.61 (Python venv), headless chromium only. Console + `pageerror` +
  non-2xx responses + failed requests captured on every page. No native dialogs triggered.
  The **live "Send sequence"** path is wired on connected briefs — it was **deliberately not
  clicked** (a real HubSpot enrollment/send). Sequence/feedback writes were also not fired;
  those endpoints were checked only via their unauth guard.
- The only files added are the screenshots under `docs/screenshots/e2e-2026-07-13/` and this
  report. The 34 pre-existing uncommitted files were not touched.

---

## Per-flow walkthrough (each proved by a re-runnable Playwright script this session)

Note on route names: the prompt/spec call the feed `/scoreboard` and `/signals` a "Signal
Catalog." **The code disagrees and the code is the source of truth** (per the prompt): the feed
is **`/`**, `/scoreboard` is the **ROI scoreboard**, `/signals` is a **Data-Sources intro**.
Tested against the real routes. (Logged as **E2E-04**.)

| # | Flow | Route(s) | Result | Screenshot(s) | Console / network |
|---|------|----------|--------|---------------|-------------------|
| 1 | **Auth** — sign-in page + route gate | `/login`; gate on `/`, `/scoreboard`, `/integrations`, `/practice/[id]` | **PASS** (11/11) | `auth-login.png`, `auth-gate-redirect-to-login.png` | clean |
| 2 | **Feed** — real practices, ranked hottest-first, freshness tie-break, vertical filter + search | `/` | **PASS** (11/11) | `feed-all-ranked.png`, `feed-filter-orthopedics.png`, `feed-search-no-match.png` | clean |
| 3 | **Brief** — buying-moment headline, cited signals, decision-maker, 2-tier card + honest degraded states | `/practice/[id]` | **PASS** (19/19) | `brief-atglance-named-contact.png`, `brief-prep-cited-claims.png`, `brief-roleonly-send-gated.png`, `brief-missing-state.png` | clean |
| 4 | **CRM connect** — HubSpot connect surface + OAuth start/error paths | `/integrations`, `/api/hubspot/oauth[/start]` | **PASS** | `integrations-connected.png`, `integrations-oauth-error-banner.png` | clean |
| 5 | **Outreach & send** — editable 3-touch sequence surface + send gate/guards | brief sequence surface; `/api/send`, `/api/sequence` | **PASS** (renders + gated; live send not fired) | `brief-atglance-named-contact.png` | clean |
| 6 | **Signals** — data-source intro (Adzuna · Google · GDELT), Skip → feed | `/signals` | **PASS** | `signals-data-sources-intro.png` | clean |
| 7 | **ROI scoreboard** — page renders with honesty tags + scope toggle, **but every metric reads 0/— after the documented seed** | `/scoreboard` | **FAIL (data)** — page OK, funnel empty → **E2E-01** | `scoreboard-empty-after-seed-E2E-01.png`, `scoreboard-scope-dermatology.png` | clean |

Screenshots live in `docs/screenshots/e2e-2026-07-13/`. Every flow above was asserted by a
Playwright script; no flow is marked PASS on inspection alone.

### What genuinely works (evidence worth keeping)
- **Ranking + freshness (feed).** 13 real rows; the only 2-signal practice (Texas Orthopedics)
  ranks #1; the rest are 1-signal ordered fresh-first (a run of 2-day rows above the 3-day rows).
  Vertical filter counts exactly match the DB (Orthopedics 6 · Women's Health 5 · Dermatology 2 · All 13).
- **Cited brief (D2).** The "Prep for call" tier reveals **10 real source links** on the hero brief;
  every claim's `href` is an `http(s)` source URL. Named decision-maker (Jennifer Hadley, Medical
  Office Manager) with a working LinkedIn deep-link (`/in/jennifer-hadley-…`) and Facebook people-search.
- **Honest degraded states.** `role_only` contact → "No public decision-maker surfaced yet"; a brief
  with no contact email correctly gates send ("…nothing to send") and shows **no** live button; a
  practice with no brief → the designed "No brief yet" card (HTTP 200, not a 500).
- **OAuth (CRM connect).** Start `→ 307` to `app.hubspot.com/oauth/authorize?client_id=…`; the
  denied/`?error=…`/no-param callbacks all `→ 307` back to `/integrations?error=connect_failed`
  with a graceful banner ("That HubSpot connection didn't go through…"). No 500s.
- **Fail-closed.** Logged-out, every protected route `→ 307 /login`; unauth `POST /api/send`,
  `POST /api/sequence`, `POST /api/feedback`, `GET /api/hubspot/oauth/start` all `→ 307` (gated).
- **Honest empty scoreboard.** Even while empty (E2E-01), the scoreboard shows **no** `NaN`/
  `Infinity`/`undefined` — every ratio is denominator-guarded to `—`.

---

## E2E-01: ROI scoreboard is empty after the documented `pnpm db:seed` — the seed's funnel is written onto `demo:` practices that every scoreboard query excludes
- **Severity:** high
- **Category / flow:** ROI scoreboard · `/scoreboard` (data pipeline: `scripts/seed-demo.ts` → `db/queries.ts` → `app/scoreboard/data.ts`)
- **Where:** `db/queries.ts` — `roiEventRows` (`excludeDemoPractices` at line 194), `costByVertical` (line 217), `feedbackRows` (line 241), `cycleRows` (line 258) all apply the `demo:%` geo-key filter. `db/seed-demo.ts` writes the entire demo funnel onto practices whose `geoKey` is `demo:<key>` (line 326) and whose docstring (line 36) says it fills "`roi_events` / `cost_events` / `feedback` / `crm_links` **for the scoreboard**."
- **Evidence:** After `pnpm db:seed`, `roi_events` went 1 → 51 and `feedback` 0 → 10, yet `/scoreboard` still renders **Deals won 0 · CAC — · Meetings 0 · Cost/meeting — · every specialty 0%/— · big-test 0 meetings·0 deals** (`scoreboard-empty-after-seed-E2E-01.png`; Playwright asserted `Deals=0, Meetings=0`). A demo-vs-real split of the seeded events proves why:
  ```
  event_type        demo  real (what the scoreboard counts)
  lead_pushed        19    0
  meeting_booked     10    0
  deal_won            4    0
  time_saved_estimate 18   0
  feedback:          demo=10  real=0
  → scoreboard (excludeDemo): Leads=0  Meetings=0  Deals=0
  → seed funnel that is EXCLUDED: Meetings=10  Deals=4
  ```
  Query used (re-runnable against `DATABASE_URL`): join `roi_events`→`practices`, split by `geo_key LIKE 'demo:%'`.
- **What is wrong:** The scoreboard is one of the three product pillars (Req #3) and has its own README shot, but after the exact documented populate step it shows a dead, all-zero dashboard. The feed *should* exclude `demo:` practices (they aren't real prospects), but the scoreboard applies the **same** filter to the funnel/cost/feedback tables — so the only data that exists (the seed's) is filtered straight back out. There is no other documented path that fills it. An EliseAI reviewer opening `/scoreboard` sees zeros everywhere.
- **Recommended fix:** Make the seed's funnel reach the scoreboard. Cleanest: **drop `excludeDemoPractices` from the four scoreboard read helpers** (`roiEventRows` / `costByVertical` / `feedbackRows` / `cycleRows`) — the scoreboard is a demo-impact surface, and the seed exists precisely to populate it. (Alternative: attach the seed's funnel/cost/feedback/crm rows to non-`demo:` practices — but that changes what "demo" means and risks polluting the feed, so the query change is safer.) Add a test that a seeded DB yields non-zero Deals/Meetings on `/scoreboard`.
- **Status:** FLAGGED FOR PRODUCT DECISION (fix not auto-applied)
- **Resolution:** I deliberately did **not** apply the recommended fix, because it collides with a
  deliberate honesty guarantee. `db/queries.ts:38-71` documents that `excludeDemoPractices` is the
  single source of truth keeping fabricated seed data out of *both* the feed and the scoreboard, to
  honor **D9** ("fabricated seed ROI rendered as real would violate D9"). Dropping it from the
  scoreboard helpers would make the board render seeded, made-up deal/meeting numbers as if they were
  *measured* ROI, on a product whose entire pitch (going to EliseAI) is citation-faithful honesty.
  That trades an honestly-empty dashboard for a dishonest one. The real inconsistency is that the
  seed's docstring *claims* it populates the scoreboard while the queries exclude what it writes.
  Honest options, all product calls:
  1. **Keep the scoreboard demo-excluded (recommended)** and fix the seed's misleading docstring; the
     scoreboard's demo-ability already exists via the styleguide fixtures (`db/queries.ts:43-44`).
  2. Add an explicit, clearly-labeled "demo data" mode/flag the scoreboard opts into, so seeded
     numbers are shown *as demo*, never as measured.
  3. Wire real outcome ingestion (COV-11) so the board fills with genuine measured data.
  Surfaced for a human decision; not auto-actioned, per the rule that honesty-affecting product calls
  belong to a person.

---

## E2E-02: Proof-point card shows a "Measured" honesty badge even when there is no proof ("Proof pending")
- **Severity:** medium
- **Category / flow:** Brief · `/practice/[id]` · call-prep tier (honesty tags, D10)
- **Where:** `app/brief-view.tsx:644` — the `<Badge>Measured</Badge>` is rendered *unconditionally*, above a body that switches on `factual.proofPoint.tag === "real"` (lines ~648–668). When the tag is not `"real"`, the body reads "Proof pending. No customer-success metric found for this vertical yet." while the badge still says **Measured**.
- **Evidence:** On the hero brief (Texas Orthopedics), the "Proof point" card shows `Measured` directly over "Proof pending. No customer-success metric found for this vertical yet." (`brief-prep-cited-claims.png`, "Why EliseAI fits" section). Blast radius: **8 of 28 briefs** have a non-`real` proof point (every Orthopedics brief — the spec flags orthopedics proof as a research TODO), so this misfires across a whole vertical.
- **What is wrong:** D10's load-bearing rule is "we never dress a projection up as a measurement." A "Measured" badge over "no metric found" dresses an *absence* up as a measurement — the exact honesty failure the tag exists to prevent. (Contrast the ROI-range card, whose "Modeled" badge is always correct because that content is always modeled.)
- **Recommended fix:** Move the `Measured` badge **inside** the `tag === "real"` branch (so the pending state carries no badge), or render a neutral "Pending" badge in the `else` branch. Add a render test that a `proof_pending` proof point never shows "Measured."
- **Status:** FIXED
- **Resolution:** Extracted the proof-point card into an exported `ProofPointPanel` in
  `app/brief-view.tsx` and made the badge conditional: `"Measured"` only when `tag === "real"`,
  otherwise `"Pending"`. So a `proof_pending` proof never shows "Measured" over "Proof pending"
  (D10). Test-first (red→green) via the new component harness: `tests/ui/brief-panels.test.tsx`
  asserts pending shows no "Measured" badge and real does (positive control). Verified: 4 passed,
  typecheck + eslint clean.

---

## E2E-03: "Incumbent tooling" card renders as a bare heading with no body (and no empty-state) when there is no tooling data — on 21 of 28 briefs
- **Severity:** medium
- **Category / flow:** Brief · `/practice/[id]` · call-prep tier
- **Where:** `app/brief-view.tsx:617–627` — the Incumbent-tooling `Card` always renders its `SectionHeader title="Incumbent tooling"`, then maps `factual.incumbentTooling`. When that array is empty the card is a title over blank space; unlike the proof-point card, there is no "none found" fallback line.
- **Evidence:** On the hero brief the "Incumbent tooling" card is empty (`brief-prep-cited-claims.png`, top-right of the profile row). **21 of 28 briefs** have an empty `incumbentTooling` array, so this blank card is the default state, not an edge case.
- **What is wrong:** On the flagship brief screen a reviewer scrutinises, a titled card with nothing under it reads as unfinished/broken. It's the one section of the call-prep tier without an honest empty state.
- **Recommended fix:** When `incumbentTooling` is empty, render an empty-state line (e.g. "No incumbent front-desk/phone/scheduling tool identified yet.") matching the proof-point card's pattern, or omit the card entirely for that brief. Small, self-contained change.
- **Status:** FIXED
- **Resolution:** Extracted the card into an exported `IncumbentToolingPanel` in `app/brief-view.tsx`;
  when `tooling` is empty it now renders an honest empty state ("No incumbent front-desk, phone, or
  scheduling tool identified yet.") instead of a bare heading. Test-first (red→green):
  `tests/ui/brief-panels.test.tsx` asserts the empty state appears when empty and the rows render
  when present. Verified: 4 passed, typecheck + eslint clean.

---

## E2E-04: Route/feature names in the prompt & spec disagree with the shipped code
- **Severity:** low
- **Category / flow:** Docs vs code (flagged per the prompt's "trust the code, flag the mismatch")
- **Where:** This prompt (`dev-process/qa-review-prompts/2-live-e2e__webapp-testing.md`) and `docs/spec.md`.
- **Evidence:** The prompt calls the feed **"(`/scoreboard`)"**, but `app/page.tsx` (route `/`) is the feed and `app/scoreboard/page.tsx` is the ROI scoreboard (`docs/scoreboard-metrics.md` agrees). The spec's Signal Catalog implies `/signals` is a catalog; the shipped `/signals` is a Data-Sources intro animation (Adzuna · Google · GDELT) that "Skip" completes into the feed — matching the `src/lib/auth.ts` `publicPaths` comment, not the spec table.
- **What is wrong:** Only a documentation drift — no user-facing bug. Called out so the next reader doesn't test the wrong URL (as the prompt's own route list would have led them to).
- **Recommended fix:** Correct the route names in this QA prompt (feed = `/`, scoreboard = `/scoreboard`) and note in `docs/spec.md` that `/signals` ships as the Data-Sources intro, not the full catalog table.
- **Status:** FIXED (doc)
- **Resolution:** Added a "Route names (code is source of truth)" line to the implementation-status
  note at the top of `docs/spec.md`: feed = `/`, `/scoreboard` = ROI scoreboard, `/signals` = the
  Data-Sources intro (not a full catalog). No user-facing bug; this stops the next reader testing the
  wrong URL.

---

## Non-findings / observations (not bugs — recorded so they aren't re-investigated)
- **Bottom-left "N" badge** in every screenshot is the **Next.js dev-mode indicator** (Turbopack).
  Dev-only; it will not appear on the deployed demo. Not an app element.
- **OAuth callback redirects to `http://localhost:3000/…`** (not `:3100`) because it uses the
  `HUBSPOT_REDIRECT_URI` origin from `.env.local`. Correct for the registered HubSpot app / prod
  URL; only a local-dev artifact when the dev server runs on a non-3000 port. No change needed for
  the demo.
- **Onboarding tour** (`RevopsTour`) auto-opens over the feed on first load (localStorage-gated,
  key `bme.revops-onboarding.v1`). Expected UX; suppressed via an init-script for the clean shots.
- **`pnpm db:seed` was run this session.** It is idempotent + `demo:`-scoped and did not touch the
  5 real practices; it added the demo funnel used to surface E2E-01. Feed still shows exactly the 13
  real practices afterward (demo rows correctly excluded).
