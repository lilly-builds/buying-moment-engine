---
title: "chore: Fill or honestly refresh the orthopedics proof-point gap"
date: 2026-07-10
type: chore
depth: lightweight
origin: thread-prompts/09-orthopedics-proof-point.md
status: planned
---

# chore: Fill or honestly refresh the orthopedics proof-point gap

**Target repo:** buying-moment-engine

## Summary

Orthopedics is the only vertical pack shipping `proofPoint: { tag: "proof_pending" }`
(`src/packs/orthopedics.ts`) — every sibling (`dermatology`, `womens-health`,
`ophthalmology`) ships a `real` EliseAI customer proof with a citable metric + source
URL. This plan runs an **exhaustive, honest fresh web hunt** (beyond the documented
2026-07-07 sweep) for a real, citable EliseAI orthopedics proof point, then does exactly
one of two things:

- **Found** a genuine, click-verified ortho (or ortho-inclusive) proof → fill `proofPoint`
  with `{ tag: "real", caseStudy, metrics, sourceUrl }` matching the sibling shape, add a
  ledger row to `docs/pack-sources.md`, update the `packs.test.ts` assertion, and (if the
  proof is *adjacent* — multi-specialty/MSO/ASC, not pure ortho) flag it loudly in a code
  comment + the report for a human attribution call.
- **Nothing qualifies** (the likely, honest outcome) → **keep `proof_pending`**, and
  refresh the negative-result trail in `docs/pack-sources.md` with today's date
  (2026-07-10) and every new source checked, so the pending state is provably current.

Rule #1 governs everything: **never fabricate or inflate a proof.** A documented, current
"pending" is a strength (it proves the author won't invent customer data); a fabricated or
proxy win is disqualifying.

## Problem Frame

- **R5** (spec D9 / build-plan): every proof point carries a citation; the brief never
  states an uncited fact — so an unattributed stat (e.g. the uncontextualized "34%"
  graphic on EliseAI's ortho vertical page) or a platform-wide number can NEVER become a
  customer proof.
- **R6 / U7 / U13**: "one engine, four pitches" — a vertical pack is exactly five authored
  variables; the `proofPoint` is a Zod discriminated union allowing **only** `{ tag:
  "real", caseStudy, metrics[], sourceUrl }` or the `{ tag: "proof_pending" }` sentinel.
  There is no third "sort-of" state; a blank/proxy/unattributed proof fails validation by
  design (`src/packs/schema.ts`).
- The 2026-07-07 sweep found **no** named EliseAI ortho / surgery-center customer with a
  citable metric (`docs/pack-sources.md` § Negative results). The gap is real; the task is
  to re-hunt honestly and prove the pending state current, OR close it with a real find.

## Scope Boundaries

**In scope:** the fresh hunt; `src/packs/orthopedics.ts` `proofPoint` (+ its header
research-date note); `docs/pack-sources.md` (a new proof row OR a refreshed negative-result
trail dated 2026-07-10); `tests/packs/packs.test.ts` ortho assertion **only if** a real
proof is filled.

**Out of scope / do not touch:** the other three packs; the pack schema; the loader; the
authored `painFit`/`opener`/`ehrSignals`/`roiBenchmark` fields — *except* the optional
deepen-if-genuinely-thin allowance below. No DB import (packs stay pure data).

### Deferred to Follow-Up Work
- Deepening `painFit` grounding / `ehrSignals` / `roiBenchmark` citations is **optional**
  and only if a stronger citation is click-verified in passing — never at the cost of rule
  #1, and only as a tiny addition. Default: leave them untouched.

## Key Technical Decisions

1. **Honesty over completeness.** When in doubt, stay `proof_pending`. The sentinel exists
   precisely to prevent a proxy metric. (R5, guardrail #1.)
2. **Click-verify, not search-summary.** A candidate only qualifies if the actual page
   resolves (not a redirect/login/404) and, with my own eyes, names the customer AND states
   the metric AND is attributable to EliseAI. Tag every finding verified vs inferred.
3. **Adjacent ≠ ortho.** A multi-specialty/MSO/ASC win that names orthopedics + a metric is
   *fillable but must be flagged* (code comment + report) for a human attribution call — do
   not quietly pass a non-ortho win as ortho.
4. **Ledger updated either way.** `docs/pack-sources.md` must reflect what was done — a new
   proof row, or a refreshed negative-result trail dated today.
5. **Test stays in sync.** `tests/packs/packs.test.ts` line ~72 hard-asserts
   `proofPoint == { tag: "proof_pending" }`. Filling a real proof REQUIRES updating that
   assertion (to `tag: "real"` + the case-study name), matching the sibling test shape.
   Staying pending leaves the test unchanged.

## Implementation Units

### U1. Exhaustive fresh hunt for a real EliseAI ortho proof point

**Goal:** go beyond the 2026-07-07 sweep and settle, with evidence, whether a real citable
ortho proof exists.
**Requirements:** R5 (citation-or-nothing), U13 (research gate).
**Dependencies:** none.
**Files:** none (research only; findings feed U2/U3).
**Approach:** new angles the prior sweep did not cover —
  1. EliseAI press/blog **published after 2026-06-10** (the $200M-ARR release cutoff).
  2. Webinar / conference / YouTube case-study talks naming an ortho customer + metric.
  3. G2 / Capterra / review-site entries naming an ortho EliseAI customer.
  4. **Adjacent** customers — a multi-specialty group, MSO, or ASC whose EliseAI story
     explicitly names orthopedics AND carries a metric.
  5. Re-check the canonical surfaces for anything new since 2026-07-07: customer-stories
     index, `/healthai`, ortho vertical page, ortho blog post.
**Approach guardrail:** every promising hit gets click-verified (WebFetch the real page);
a search snippet is a hypothesis, never proof.
**Verification:** a decision — either a click-verified candidate (URL + customer + metric,
quoted from the page) or a documented, dated list of every new source checked that turned
up nothing.
**Test expectation: none** — research unit; its output gates U2/U3.

### U2. Fill `proofPoint` (ONLY if U1 found a genuine, click-verified proof)

**Goal:** promote a real find into the pack, matching the sibling shape.
**Requirements:** R5, R6, U7 (real-proof union member).
**Dependencies:** U1.
**Files:** `src/packs/orthopedics.ts`, `docs/pack-sources.md`, `tests/packs/packs.test.ts`.
**Approach:** replace the `{ tag: "proof_pending" }` sentinel with
`{ tag: "real", caseStudy, metrics: [...], sourceUrl }` transcribed verbatim from the
verified page (mirror `src/packs/dermatology.ts` lines 42–53). Update the header comment to
record the find + its date. Add a proof row to `docs/pack-sources.md` § "EliseAI customer
stories & blog". If the proof is *adjacent* (not pure ortho), add an inline code comment
flagging the attribution question for the reviewer. Update the `tests/packs/packs.test.ts`
ortho assertion from `proof_pending` to `real` + the case-study name (mirror the derm test).
**Patterns to follow:** `src/packs/dermatology.ts` (real-proof shape); its `packs.test.ts`
block (lines 45–52).
**Test scenarios:**
  - `loadPack(orthopedicsPack).ok === true` with the new `real` proof (Zod union passes).
  - ortho proof-point test asserts `tag === "real"` + the case-study name + a live-looking
    `sourceUrl` (replacing the old `proof_pending` assertion).
  - `getAllPacks()` still validates 4/4.
**Verification:** `pnpm test tests/packs`, `pnpm typecheck`, `pnpm lint` all green; the
filled URL resolves to the exact page cited.

### U3. Refresh the negative-result trail (the likely outcome — stay `proof_pending`)

**Goal:** prove the pending state is current, not stale.
**Requirements:** R5 (honest empty state), U13.
**Dependencies:** U1.
**Files:** `docs/pack-sources.md`, `src/packs/orthopedics.ts` (header comment date only).
**Approach:** update the § "Negative results / dropped claims" row for *"Any named EliseAI
orthopedics / surgery-center customer"* to append a **2026-07-10 re-sweep** line listing
every new source checked (post-2026-06-10 press/blog, webinar/YouTube, G2/Capterra,
adjacent MSO/ASC stories) and the outcome. Update `src/packs/orthopedics.ts`'s header
research-date note so it reads as re-verified 2026-07-10 (keep `proof_pending`; do NOT
touch the `proofPoint` value or the test).
**Patterns to follow:** the existing negative-result table rows in `docs/pack-sources.md`.
**Test scenarios:**
  - ortho proof-point test still asserts `proofPoint == { tag: "proof_pending" }` (unchanged
    and still green).
  - `getAllPacks()` validates 4/4 (data untouched).
**Test expectation: none beyond the existing green suite** — this unit changes only docs +
a comment; correctness is "existing pack tests stay green + the ledger reflects today's
sweep."

## Requirements Traceability

| Req | Where honored |
|---|---|
| R5 — every proof carries a citation; never fabricate | U1 click-verify gate; U2 verbatim transcription + ledger row; U3 honest dated trail |
| R6 / U7 — five-variable pack, real-or-pending union only | U2 fills the `real` union member; schema untouched |
| U13 — ortho research gate | U1 fresh hunt; U2/U3 record the outcome |

## Risks & Mitigations

- **Risk: promoting a proxy/unattributed stat into a proof.** Mitigation: KTD #1–#2, the
  click-verify gate, and the schema itself (blank/proxy fails Zod).
- **Risk: filling a real proof but forgetting the pinned test → red suite.** Mitigation:
  U2 explicitly updates `tests/packs/packs.test.ts` in the same diff.
- **Risk: an adjacent (non-ortho) win quietly mislabeled ortho.** Mitigation: KTD #3 — flag
  in code comment + report, human decides.

## Verification (whole change)

- `pnpm test tests/packs` green (31+ tests).
- `pnpm typecheck` + `pnpm lint` green.
- `docs/pack-sources.md` reflects the actual outcome (proof row OR dated negative trail).
- Small, focused diff on a fresh worktree branch `ortho-proof-point` off `origin/main`.
- **PR to main — do NOT merge.** Report found-and-filled (with citation) or
  refreshed-and-still-pending (with the trail). Lilly decides.
