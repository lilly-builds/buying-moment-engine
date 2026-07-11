# RevOps Onboarding Tour — Edit Pass (Handoff)

**Date:** 2026-07-10
**Status:** ALL APPLIED + a review round on top (see "Review round 2" below). Lint 0 errors,
1033 tests pass, typecheck clean except two pre-existing `searchParams` type-gen errors
(the untouched login page has them too). Not committed yet.
**Scope:** the RevOps "connect your stack" spotlight tour built this session.

## Files
- Step copy (data): `src/onboarding/integrations-tour-steps.ts`
- Controller: `app/onboarding/revops-tour.tsx`
- Card: `design/components/onboarding/step-card.tsx`
- Spotlight engine: `src/onboarding/spotlight.ts`, `design/components/onboarding/spotlight-overlay.tsx`
- Integrations page/view: `app/integrations/integrations-view.tsx`, `app/integrations/page.tsx`
- Value box to DELETE: `app/integrations/value-opener.tsx`
- Top nav (needs a hook for E5): `design/components/top-nav.tsx`
- Scoreboard (already has the `roi-scoreboard` hook): `app/scoreboard-view.tsx`

## Governing principles — apply to EVERY step
1. **Never assume they know the app.** Slide 1 must name GTM Maestro and say what it does. Write like they've never seen it before.
2. **3rd-grade, obvious language.** No cryptic or insider phrasing. We are teaching them the app.
3. **Transitions between sections AND pages.** Never hard-jump. When we move to a new page (scoreboard, integrations), show them WHERE it lives (the nav button/header) first, then dive into the details. Teaching navigation is part of onboarding.
4. **No em dashes. "prospect" not "practice."**
5. Keep the AE spotlight structure (dim the page + spotlight one real thing + floating StepCard).

---

## Edits to apply

### E1 — Slide 1 (step `feed-ready-to-buy`): restore the locked header (REGRESSION — my miss)
Slide 1 lost the app-naming header when the copy got distributed across steps. Restore the locked copy:
- **Header (the `line`):** "GTM Maestro finds prospects that are ready to buy right now, with the email already written and the call brief already prepped." (bold suggestion: **ready to buy right now**)
- **Description (the `detail`):** "Clay, Apollo, and ZoomInfo find who fits your market. This finds who's ready to buy today, from real timing-based signals: a prospect on a front-desk hiring spree, patient reviews about long hold times and calls that go unanswered, a new location opening."
- The header is a full sentence, so it will wrap to 2–3 lines in the card — fine for the welcome slide.
- The "Each prospect comes done…" and "Your reps save an hour…" lines live on LATER slides (steps 2 and 6). Do NOT duplicate them on slide 1.

### E2 — Step 2 (`feed-open-brief`): line flows badly
- **Current line:** "Each one comes done for the rep. Open the brief."
- **Change:** rewrite for better flow. **Proposal:** "Open any prospect. The brief is **already done**." (leave the detail: "The research, the outreach, and the call brief are already written.")

### E3 — Step 3 (`brief-why-now`): detail is cryptic
- **Current detail:** "The timing signal that fired, cited to its source."
- **Change:** plain, 3rd-grade. **Proposal:** "It's what just happened at the prospect that makes them ready to buy. Tap any fact to see where it came from."

### E4 — Step 4 (`brief-email`): make it sound more valuable
- **Current line:** "The email is already written."
- **Change to:** "The email is already **customized to the prospect**."

### E5 — ROI transition + navigation (NEW step, before the scoreboard detail)
- **Problem:** the payoff (step 6) hard-jumps to the scoreboard page and its details, with no transition and no navigation cue.
- **Change:** add a beat that shows the **Scoreboard nav button** FIRST (teach where it lives), THEN navigate into the scoreboard details.
  - Add `data-tour="nav-scoreboard"` to the "Scoreboard" link in `design/components/top-nav.tsx`.
  - New step (on the brief page, right after the payoff): spotlight `nav-scoreboard`. Copy e.g. line "And you can **see it's working**." / detail "Your ROI Scoreboard lives up here — let's look." (rewrite to house style, no em dash). This step's `nav` = `scoreboard`.
  - Then the existing scoreboard-detail step spotlights `roi-scoreboard`.

### E6 — Integrations transition / overview (NEW step, before the connect steps)
- **Problem:** hard-jump straight to "To go live, connect HubSpot…" with no overview of what's being connected.
- **Change:** add an overview step that frames all three connections first (this existed in the locked copy):
  > **To activate GTM Maestro's full value, connect:**
  > - **HubSpot:** sends every email from your team's own inbox, and tracks each lead, meeting, and deal in your CRM
  > - **Anthropic (Claude):** researches each prospect and writes the brief
  > - **People Data Labs:** finds the decision-maker's verified email and LinkedIn (at lower cost than Clay or Apollo)
- Then proceed to spotlight HubSpot → Anthropic → People Data Labs individually.
- **Implementation note:** the StepCard renders `line` + `detail` + `chip` only. A 3-bullet list needs either a small StepCard variant that supports a `bullets` list, or a distinct card (like the finale). Recommend adding an optional `bullets` field to the step + card. Decide at apply-time.

### E7 — Final slide: new value line (PICK ONE — pending Lilly)
- **Current (disliked):** "Your reps get every ready-to-buy prospect researched and written up." + "Just connect 3 tools to give your team the full value."
- **Options (headline; keep the "Just connect 3 tools…" guide line):**
  1. "Every prospect, fully researched and written up before your rep lifts a finger."
  2. "Your reps stop researching and start selling."
  3. "An hour of research saved on every lead, and outreach that lands when they're ready to buy."
- **Chosen:** _______ (fill in)

### E8 — Delete the value box on the integrations page
- The `<ValueOpener>` at the top of the integrations page is redundant now that the tour carries the value pitch, and it still shows old copy ("12 hot leads", "last inch").
- **Change:** remove `<ValueOpener>` from `integrations-view.tsx`; delete `app/integrations/value-opener.tsx` and its import.
- Then clean up now-unused plumbing: the `leadCount` / `firstBriefHref` props on `IntegrationsView` + `page.tsx` + the styleguide page. **Keep** the pure helpers `describeLeadValue` / `firstBriefHref` in `connections.ts` — they're covered by `tests/integrations/connections.test.ts`.

### E9 — Confirm it runs on the REAL integrations page
- The tour is built into the shared `IntegrationsView` and mounted in the root layout, so it already runs on the real `/integrations`. `/styleguide/integrations` is only a no-login PREVIEW of the same view, used for review.
- No wiring change needed — just confirm the integration steps render on the authenticated `/integrations` too (real connection status instead of the fixture's disconnected state).

---

## Already applied this round (for record)
- Step 5 focuses the "Prep for call" toggle; step 6 payoff focuses "Why EliseAI fits."
- Step 9 Anthropic detail: "It applies Claude to research each prospect and write a call prep brief."
- ROI scoreboard preview step added; finale "Start connecting" scrolls up to the HubSpot row.
- Copy cleanup: em dashes removed, "practice" → "prospect" across the onboarding surface.

## Step order
- **Now (pre-E5/E6):** 1 feed-top · 2 open-brief · 3 why-now · 4 edit-email · 5 prep-toggle · 6 why-fits · 7 roi-scoreboard · 8 connect-hubspot · 9 key-anthropic · 10 key-pdl · finale
- **After E5 + E6:** insert a `nav-scoreboard` beat before the scoreboard detail, and a `connect-overview` beat before the connect steps → **12 steps** + finale.
