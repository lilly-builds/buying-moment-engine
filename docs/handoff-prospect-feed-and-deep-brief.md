# Handoff — Prospect Feed (U8) + Deep Brief (U9)

**Written:** 2026-07-08 · **Status:** setup + merge DONE, no UI built yet
**Worktree:** `/Users/love/Developer/bme-prospect-feed-and-deep-brief`
**Branch:** `feat/prospect-feed-and-deep-brief` · **Tip:** `345282d` (merge commit)

Goal: build the two dashboard screens **from the existing design kit only**. The
Data Sources page is **not** in scope (Lilly designs it in Canva first; the build
plan has no unit for it — it is net-new scope).

---

## 1. What is already done

- Created this worktree/branch, stacked on `wave-3-u6`, then **merged `main` into it**.
  That merge was mandatory: U8 needs U2's design kit (only on `main`) **and** U6's
  brief contract (only on `wave-3-u6`). `wave-3-u6` forked before U2 landed, so
  `design/` did not exist on it.
- Merge resolved 3 conflicts + 1 semantic fix (see `git show 345282d`). The semantic
  one: `publicPaths()` on `main` exempted `/api/enrich-callback` from auth, but U5
  deleted that route. Removed the exemption; inverted its test to assert it is gated.
- Tree is clean. `pnpm install` done. `.env.local` copied in (gitignored).

**Nothing in `app/` has been touched yet.** `app/page.tsx` is still the raw
`zinc-*` placeholder.

---

## 2. Hard constraints — read before writing a line

### Machine (this is real, not advisory)
- 8 GB RAM, disk **97% full** (~16 GiB free), swap ~4.2 / 5.1 GB.
- **Four other Claude Code sessions are running.** One owns
  `/Users/love/Developer/bme-wave-3-u5` (branch `wave-3-u6`) — **do not touch that
  worktree**. It ran a vitest suite that pinned the box at load 20+ and starved
  Chrome's renderer (screenshots came back blank white).
- A dev server for the **main** checkout already runs on **:3000** (PID 42540).
  If you need one here, use a different port (`pnpm dev -- -p 3100`) and stop it after.
- Never run two heavy things at once. `vitest.config.ts` is capped at `maxWorkers: 4`,
  `hookTimeout: 30_000` for a reason: each data-layer suite boots a WASM Postgres per test.

### Next.js
`AGENTS.md`: *"This is NOT the Next.js you know."* v16.2.10. **Read
`node_modules/next/dist/docs/` before writing route code.** In particular confirm
whether `params` in `app/practice/[id]/page.tsx` is a **Promise** (it is in recent
Next) before typing it.

### Design system — the contract
- Import **only** from `@/design/components`. Never build a parallel component.
- Tokens live in `design/tokens.ts`, mirrored verbatim into the `@theme` block of
  `app/globals.css`. **Tailwind v4 — there is NO `tailwind.config.ts`.** Never add one.
- `tests/design/tokens.test.ts` fails if the two drift.
- **Read `design/rules.ts` first.** Every rule was earned by shipping the mistake it
  forbids. `/styleguide` renders them. The ones that bite:
  - Never a raw hex. Never a class name built by interpolation (`rounded-${x}` emits no CSS).
  - Every chip carries `w-fit` (this bug shipped 3× in U2).
  - A repeated item is `Card variant="flat"`. `outlined`/`elevated` lift ONE thing.
  - Never state a fact twice — 3 SignalPills already say "3 signals"; a count badge repeats them.
  - Cut any line that doesn't change a decision — **location belongs in the brief, not the feed row**.
  - `py-section` (120px) is EliseAI's MARKETING rhythm. Content density = `gap-2/4/6/8` (8/16/24/32px).
  - Colour encodes, never decorates. Never dim a fill with opacity.

### Never (global rules)
No `any`, no `@ts-ignore`, no disabled lint/type checks, no weakened tests.
Do **not** write fake signals into the real Supabase DB. Fixtures are authored from
scratch — never cloned from real records.

---

## 3. The design is already approved — port it, don't redesign it

`app/styleguide/feed-demo.tsx` **is the source of truth** for the feed. Read it. Shape:

```
<div className="relative overflow-hidden rounded-card" style={{backgroundImage: gradients.healthHero}}>
  <div className="flex flex-col gap-8 p-14">        {/* 56px inset */}
    <SectionHeader title="Prospects at a buying moment" tone="dark" size="h4" as="h3"
                   action={<SegmentedControl label="Filter feed by vertical" .../>} />
    <div className="flex flex-col gap-4">
      {rows.map(...)}  {/* or the designed empty state Card */}
    </div>
  </div>
</div>
```

One row (`FeedCard`):
```
<Card variant="flat" padding="md">
  <div className="flex flex-wrap items-center justify-between gap-8">
    <div className="flex min-w-0 flex-col gap-3">
      <h4 className="font-display text-h5 text-ink">{practice}</h4>
      <div className="flex flex-wrap items-center gap-2">{signals.map(k => <SignalPill kind={k}/>)}</div>
    </div>
    <div className="flex shrink-0 items-center gap-6">
      <FreshnessClock days={...} />
      <Button variant="primary" size="sm">View brief</Button>   {/* -> ButtonLink to /practice/[id] */}
    </div>
  </div>
</Card>
```
The demo's empty state (`Card variant="flat" padding="lg"`) is also already designed — reuse it.

Kit surface: `PageContainer, PageSection, DENSITY_GAPS, Button, ButtonLink, Card, Badge,
Tag, SignalPill, SIGNAL_LABELS, FreshnessClock, SectionHeader, TopNav, SegmentedControl`.

---

## 4. The four traps (all verified, all will bite)

### (a) The database is empty — the feed cannot render real rows
Probed live 2026-07-08 via `DATABASE_URL`:

| table | rows |
|---|---|
| practices | **5** (all `vertical = 'unclassified'`) |
| signals | **0** |
| evidence | **0** |
| contacts | **0** |

`feedPractices` excludes `unclassified` **and** `HAVING count(distinct kind) > 0`,
so it returns `[]` today. **The feed will render the empty state no matter how well
you build it.** Verify with pglite fixtures (see §6). Populating for real is a
separate, gated step (costs Anthropic + Google Places calls).

### (b) Enum skew: DB is snake_case, the design kit is kebab-case
- DB `signal_kind` pgEnum: `staffing_spike | phone_complaints | growth_events | regulation`
- DB `vertical` pgEnum: `dermatology | womens_health | ophthalmology | orthopedics | unclassified`
- Design `SignalKind` (keys of `signalGradients`): `staffing-spike | phone-complaints | growth-events`
- `feed-demo.tsx` verticals: `all | dermatology | womens-health | ophthalmology | orthopedics`

A mapping layer is required. **`design/` must not import from `db/`** — put the map in
`src/` (suggest `src/engine/display-mapping.ts`) and unit-test it.

### (c) `regulation` has no gradient — it would render an invisible pill
`DetectorKind` has **four** kinds; `signalGradients` has **three**. `signalGradients["regulation"]`
is `undefined` → `backgroundImage: undefined` → a white-on-white pill.
Per spec D3 `regulation` is 🟡 research-gated and **has no detector built**
(`src/detectors/` has only the three). Recommended: the mapping returns `null` for
`regulation`, the row skips it, and a test pins that behaviour so it can never silently
render blank. Decide explicitly — do not let it fall through.

### (d) `FreshnessClock` defaults to a 7-day window; the engine uses per-kind windows
`design/components/freshness-clock.tsx` → `STALE_AFTER_DAYS = 7`.
`src/engine/freshness.ts` → `FRESHNESS_WINDOW_DAYS = {staffing_spike: 30, growth_events: 60,
phone_complaints: 90, regulation: 180}`.

A 10-day-old staffing signal would render **red/stale** while the engine calls it **fresh**.
The component anticipated this — pass `staleAfterDays` and `stale` explicitly:
```ts
staleAfterDays={windowDaysFor(freshest.kind)}
stale={!isFresh(freshest.expiresAt, now)}
```
Open decision: with multiple signals, which window? Recommend the **freshest signal's own
kind window**, since the clock shows the freshest signal's age.

Minor: `signal-pill.tsx`'s docstring says the clock turns **amber**; it actually renders
`text-danger` (red), which is what `rules.ts` says. Fix the comment while you're there.

---

## 5. Contracts to compile against (all present in this worktree)

**`db/queries.ts`** — `feedPractices(db) -> FeedRow{id,name,city,state,vertical,signalCount}`.
Insufficient for the design: it returns **no signal kinds and no freshness**. Add a *new*
query (grep for existing `feedPractices` callers before changing its signature). Keep the
`ne(vertical,'unclassified')` filter and the `HAVING count(distinct kind) > 0` guard —
both exist for documented reasons (a zero-signal practice is not "at a buying moment").

**`src/engine/freshness.ts`** — `windowDaysFor(kind)`, `isFresh(expiresAt, now)`,
`freshnessWeight(detectedAt, expiresAt, now)`, `computeExpiresAt`. Pure.

**`src/brief/render.ts`** —
`liveSignalView(rows, now) -> {signalCount, firedSignals: FiredSignal[], freshness, mostRecentDetectedAt}`
`renderBrief(stored, rows, now) -> {factual, voice, live, headline}`
`isBriefStale`, `nextExpiryAt`, `freshnessTier`. Pure. Re-exports `isFresh`, `windowDaysFor`.
`FiredSignal = {kind, signalSource, detectedAt, expiresAt, confidence, freshnessWeight, evidenceId, sourceUrl, href}`
**Time-sensitive fields (signal count, fired list, freshness) are computed here at render
time and NEVER read from stored brief JSON.** That is a Key Technical Decision — honour it.

**`src/brief/inputs.ts`** — `buildBriefInput(db, practiceId)` →
`{ok:true, input:BriefInput}` | `{ok:false, reason:'practice-not-found'|'unclassified-vertical'}`.
Both failures are **honest states to render**, not errors to retry.

**`src/brief/schema.ts`** — the two-tier brief.
- `Claim {label, value, evidenceId, sourceUrl, quote|null, href}`.
  **`value` NEVER renders inside quotation marks; only `quote` may.** (Structural rule — read the file header.)
  `href` is already the deepest link the evidence supports (scroll-to-text fragment when a snippet exists).
- `FactualBrief {schemaVersion, vertical, practiceName, city, state, zeroSignal, headline,
  profile: Claim[], incumbentTooling: Claim[], buyingMomentContext: Claim[], painFit,
  proofPoint, roiRange, contact, signalFingerprint}`
- `ProofPointCard = {tag:'real', caseStudy, metrics[], sourceUrl, href} | {tag:'proof_pending'}`
  — `proof_pending` is a **valid** state → render "Proof pending — no customer success metrics found."
- `RoiRangeCard = {tag:'modeled', items:[{label, sourceUrl, href}]}` — the `modeled` tag is a
  literal so a card **cannot** render a modeled number as measured (D10 honesty tag).
- `ContactCard {variant:'named'|'role_only', name|null, role, email|null, emailProvider|null,
  linkedinUrl|null, bestChannel|null, sourceUrl|null, sourceHref|null, linkedinHref, facebookHref}`
  — `role_only` was the **majority** outcome on the U5 cohort (3 of 5). Not an edge case.
  In `role_only`: buttons become people-search links, and the personalization snippet is
  **dropped, never invented**.
- `VoiceBrief {headline|null, callOpener, personalizationSnippet, sequence{touches[3], namedCta},
  discoveryQuestions[2-3], objections[3]}` + `*EvidenceIds` arrays.
- `ZERO_SIGNAL_HEADLINE = "No buying moment detected yet"` — a constant, produced in code.
  `voice.headline` is `null` on that variant so prose can never invent a buying moment.

**`db/schema/brief.ts`** — `briefs {practiceId unique, factual jsonb, voice jsonb, ...}`,
`sequences {briefId, touchNumber 1..3, channel, body, cta, status 'draft', savedAt}`.
Also read `db/brief.ts` (not yet read in the prior session).

**Auth:** `proxy.ts` → `src/lib/supabase/session.ts`. `publicPaths()` = `/login`
(+ `/styleguide` outside production). So `/` and `/practice/[id]` **require a session** —
`curl localhost:3000/` returns 307. Plan how you'll view them (log in via the allowlist in
`.env.local`, or verify by rendering components in tests).

---

## 6. Verification plan (decided: fixtures now, real data later)

Author **synthetic** practices/signals/evidence/briefs from scratch into pglite
(`@electric-sql/pglite` is already a devDep; find the existing `createTestDb()` helper in
`tests/`). Never clone real records.

Must prove:
1. A 3-signal practice ranks above a 1-signal practice.
2. At equal counts, the fresher lead wins.
3. A zero-signal practice **never** enters the feed.
4. An `unclassified` practice never enters the feed.
5. The vertical filter actually filters.
6. A **10-day-old staffing signal renders FRESH, not red** (trap (d)).
7. `regulation` never renders a blank pill (trap (c)).
8. Every `Claim`'s rendered `href` equals its stored `href`/source URL.
9. `role_only` contact renders people-search links and **no** snippet.
10. `zeroSignal` brief renders the constant headline, no invented urgency.
11. Empty feed renders the designed empty state, not a blank screen.

Then render both screens in a browser and screenshot (dev server on **:3100**, not 3000).

---

## 7. Open decisions for the next session

1. **`regulation` pill** — recommend: mapping returns `null`, row skips it, test pins it.
2. **Which freshness window on the feed clock** — recommend: the freshest signal's own kind window.
3. **U9 scope.** The build plan's U9 = brief card **+ inline 3-touch sequence editor + AE
   👍/👎 feedback + send-gate**. Lilly's ask for this thread was narrower: *"the Deep Brief
   page that they'll click on the View Brief button to see."* Recommend shipping the
   **read-only two-tier brief first** (headline → recommended action → who-to-contact →
   call-prep expander, every claim source-linked), and treating the editor/feedback/send-gate
   as a follow-up commit. Confirm with Lilly.
4. **Where the mapping module lives** — recommend `src/engine/display-mapping.ts`
   (`design/` must not import `db/`).

## 8. Reference docs

- Spec: `/Users/love/Desktop/Personal Life/Career System/eliseai/eliseai-spec.md`
- Build plan: `.../eliseai/build-plan.md` — **STALE**: it claims `design/tokens.ts`,
  `design/components/`, `app/styleguide/page.tsx` "do not exist" and that U8 is blocked on
  that. They exist on `main` and are now merged here. Trust the code, not the plan.
- Build plan says the routes are `app/page.tsx` and `app/practice/[id]/page.tsx`
  (**not** `/brief/[id]`), and `app/scoreboard/page.tsx` for U12.

## 9. Task list (already created in the harness)

1. **U8a** — feed query + enum mapping layer *(in progress, nothing written yet)*
2. **U8b** — prospect feed page from the design kit *(blocked by 1)*
3. **U9** — Deep Brief page at `/practice/[id]` *(blocked by 2)*
4. **Verify** both screens against pglite fixtures *(blocked by 3)*
