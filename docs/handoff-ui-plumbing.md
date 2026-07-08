# Handoff — wire the locked UI to real data (the plumbing)

**Branch:** `feat/prospect-feed-and-deep-brief` · **Worktree:** `/Users/love/Developer/bme-prospect-feed-and-deep-brief`
**Status of the design:** LOCKED (2026-07-08). The three screens — feed (U8), deep brief (U9), ROI scoreboard (U12) — are approved and built as pure, prop-driven presentational components. Your job is the *plumbing*: feed them real data through real routes. **Do not restyle the approved UI** — only wire data into it.

---

## What's already done (don't rebuild)

The presentational components are the contract. They take plain props and render the approved design:

| Component | File | Prop contract |
|---|---|---|
| Feed | `app/feed.tsx` | `Feed({ items: FeedItem[] })` — already wired to the real home route `app/page.tsx` (DB-backed, empty-state-safe) |
| Deep brief | `app/brief-view.tsx` | `BriefView({ brief: RenderedBrief, nowMs: number })` — client island; "Send email" / "Prep for call" mode toggle |
| ROI scoreboard | `app/scoreboard-view.tsx` | `ScoreboardView({ data: ScoreboardData })` — client island; defines & exports `ScoreboardData` / `ScopeData` / `ScoreMetric` / `SignalConversion` / `VerticalRow` / `FeedbackSummary` / `BigTest` |

New kit pieces added this round (in `design/components/`, exported from `index.ts`): `StatTile`, `Meter`, `StatRing`; `SignalPill` gained a `size` prop; `SectionHeader` gained an `h5` size.

**Populated design previews** (dev-public via the `/styleguide/` prefix — no auth, no DB; fixtures live in `app/styleguide/demo-fixtures.ts`):
`/styleguide/feed` · `/styleguide/brief` · `/styleguide/scoreboard`

These fixtures (`demoBrief`, `demoFeedItems`, `demoScoreboard`) are the exact SHAPE your real queries must produce. Read them first — they are the target output of your data layer.

---

## The plumbing to build

### 1. Real deep-brief route — `app/practice/[id]/page.tsx`
The feed's "View brief" links to `/practice/{id}`; the route 404s today. Build a server component that:
- Loads the stored brief: `getBrief(db, id)` from `db/brief.ts` → handle all three statuses (`found` / `missing` / `unreadable`) with a designed state, never a crash.
- Loads the practice's signal rows (see `SignalRow` in `src/brief/inputs.ts`; the feed's query in `db/queries.ts` is the model) and calls `renderBrief(storedBrief, signalRows, now)` (`src/brief/render.ts`) → a `RenderedBrief`.
- Renders `<BriefView brief={rendered} nowMs={now.getTime()} />`.
- Follows `app/page.tsx`'s keyless-safe pattern (`export const dynamic = "force-dynamic"`; try/catch the DB; render an empty/"no brief yet" state on failure).

### 2. Real scoreboard route — `app/scoreboard/page.tsx`
The nav "Scoreboard" link 404s today. Build a server component that aggregates `roi_events` + `cost_events` into a `ScoreboardData` (aggregate + per-vertical scopes keyed `"all"` + each vertical slug) and renders `<ScoreboardView data={...} />`.
- **Honesty tags are load-bearing (D10):** tag a metric `measured` ONLY where it comes from real tool data; `modeled` where projected from benchmarks. Do not label a projected number `measured`. Where there's no data yet, degrade honestly (empty/modeled), don't fabricate.
- New aggregation queries go in `db/queries.ts`. `cost_events` already has rows; `roi_events` is empty (see §3).

### 3. Populate the data so the real routes render
DB today: 5 real practices, **0 signals / evidence / briefs / contacts / roi_events**, 13 cost_events. So the real routes render empty. Pick the path with Lilly:
- **(a) Seed script (recommended for the demo):** insert realistic signals/evidence/contacts/briefs/roi_events shaped like the fixtures. **Idempotent + non-destructive** (D13/R17): `ON CONFLICT DO NOTHING` / check-existence; **never overwrite the 5 real practices**; provenance (source URL + detected-at) on every fact; business data only, **no PHI**.
- **(b) Run the real pipeline:** ingest → enrich (Claude+PDL) → `synthesize` a brief (Opus). Real but costs API calls + keys; sizes CAC honestly. See `src/brief/synthesize.ts`, `src/enrich/*`.

### 4. Fix the design-token parity test (pre-existing red)
`tests/design/tokens.test.ts` fails: `app/globals.css` declares `--animate-signal-flow` / `--animate-card-glide-in` (added for the `/signals` page) that aren't in `design/tokens.ts` `themeVars`. Either mirror them into `themeVars` (keeps parity) or scope the test to ignore `--animate-*`. (Unrelated to the feed/brief/scoreboard UI — it's the `/signals` sub-feature.)

### 5. Verify end-to-end (the real path, not just the preview)
Real routes are auth-gated by `proxy.ts` (Supabase email allowlist; `/styleguide` + `/signals` are dev-public). To see populated *real* routes you must either log in (add the reviewer to `ALLOWLIST_EMAILS`, magic-link) or seed + view. Drive the actual routes and confirm: `/` (feed), `/practice/{id}` (brief, both modes), `/scoreboard` (toggle each scope). Show evidence.

---

## Constraints (read before editing)

- **Design is locked** — reuse `Feed` / `BriefView` / `ScoreboardView` as-is; feed them data shaped to their prop types. Don't fork the UI or restyle. If a data need reveals a genuine gap, add to the kit (`design/components/`) per `design/rules.ts`, and render the variant on `/styleguide`.
- **Kit rules** live in `design/rules.ts` (rendered at `/styleguide`): colour encodes only; flat cards for lists; never interpolate class names; never hardcode a hex (token-parity test enforces it).
- **This Next.js is modified** — `AGENTS.md` warns to read `node_modules/next/dist/docs/` before framework code. Middleware is `proxy.ts` (Next 16 rename). App Router.
- **SQL / data-engineering standards** (D13 / R4 in `../eliseai/eliseai-spec.md`): normalized, provenance on every fact, idempotent de-duped ingestion, raw-vs-derived separation, tags first-class, validate on ingest, **business data only — no PII/PHI**.
- **Spine:** SCOPE → BUILD → VERIFY → REVIEW → SHIP. Small, reversible diffs; prove it through the real route; fresh-eyes review before shipping. `/lets-hack`.

## Key files
- Prop contracts & fixtures: `app/brief-view.tsx`, `app/scoreboard-view.tsx`, `app/styleguide/demo-fixtures.ts`
- Brief data layer: `db/brief.ts` (`getBrief`), `src/brief/render.ts` (`renderBrief`), `src/brief/inputs.ts` (`SignalRow`), `src/brief/schema.ts`
- Feed data layer (the model to copy): `app/page.tsx`, `db/queries.ts` (`feedPractices`)
- ROI schema: `db/schema/roi.ts` (`roi_events`, `cost_events`)
- Auth: `proxy.ts`, `src/lib/auth.ts` (`ALLOWLIST_EMAILS`)
- Full requirements: `../eliseai/eliseai-spec.md` (D7 brief, D10 ROI, D13 data layer)
