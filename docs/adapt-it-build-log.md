# Adapt-It — overnight build log

Durable state for the autonomous overnight run (survives context compaction). Newest facts win.
Plan: `docs/plans/2026-07-11-adapt-it-saas-plan.md` · North star: `docs/plans/adapt-it-design-northstar.md`

## Where I am
- Worktree: `/Users/love/Developer/bme-adapt-it` · branch `adapt-it` (tracks origin/main, based 440191c).
- node_modules symlinked to main repo (disk is tight, ~2.8GB free). `.env.local` copied.
- Infra verified LIVE: Anthropic key (Haiku responded), Supabase DB (13 practices). Machine caffeinated.

## Phase status
- **P1 data foundation — ✅ DONE, verified.** `workspaces` table (additive migration `0009`, applied; practices still 13). `src/workspace/{schema,default,store,active}.ts`. `getActiveWorkspace()` → `{id,slug,name,config}`, falls back to synthetic EliseAI default. Seed script ran (`eliseai` row exists). 12 tests + full suite green.
- **P2 runtime theming — ✅ DONE, verified.** One runtime CSS-var override re-skins 100% of surface. 4 JS-hex gradients + StatRing promoted to `--gradient-*` / `var(--color-*)` tokens (parity test green). `design/brand.ts` `brandVars(brand)` (28 vars, pure/SSR-safe). `design/brand-provider.tsx` (`BrandProvider`, `useBrand`). Product name/wordmark from active workspace. Login restyled onto the kit. Full suite 1072 pass.
- **P3 AI Adapter onboarding — ✅ DONE, verified (incl. real Claude smoke).** `app/adapt/*` (welcome→who→ICP→buying-moment→proof→brand→reveal), `src/adapt/*`, routes `POST /api/adapt/generate` (`{companyName,whatYouSell,websiteUrl?}`→`{config,source}`) + `POST /api/adapt/finalize` (`{config}`→`{slug}`, persists + sets active cookie). Live preview via `brandVars`. Login entry point added. 12 adapt tests + suites green. Real freight-broker smoke: green palette, 3 signals, 3 sample prospects.
- **P4 adapted dashboard + Customization Studio — ✅ DONE, verified (tsc + suite + fresh-eyes review).** Feed/brief/scoreboard branch on `id === "default"`: default keeps the practices feed, `/practice/[id]`, and the real roi_events scoreboard UNCHANGED. A tenant (`id !== "default"` + `sampleFeed.length > 0`) gets `app/tenant-feed.tsx` (sample prospects, ranked by signal count, signal filter + name search), `app/prospect/[id]` → `app/prospect/[id]/sample-brief-view.tsx` (two-tier at-a-glance / call-prep, 404-graceful when id missing or default), and `app/tenant-scoreboard-view.tsx` (honest "fills in as you work leads" state — never EliseAI's global roi_events). `app/customize` = the studio (`customize-studio.tsx`): brand (live `brandVars` preview), signals, pitch, proof (proven/pending union), audience; holds the FULL config and posts it whole to `POST /api/workspace/update`, which resolves the active workspace server-side, refuses the default (409), Zod-validates (422), then `updateWorkspaceConfig`; on 200 the studio `router.refresh()` re-skins the app. Default id → read-only "adapt first" state. `app/sample-signal-pill.tsx` renders a tenant's free-form signal name in a promoted signal gradient (stable name hash). "Customize" added to TopNav. Full suite 1088 pass + 4 new route-contract tests (`tests/workspace/update-route.test.ts`). Did NOT touch `app/adapt/**` or `app/api/adapt/**`.
- **P5 landing + Jobs-caliber visual pass — ⏳ PENDING.** Front door, surface differentiation, elevation/materiality, motion, empty states.

## Key contracts (so phases integrate cleanly)
- Active workspace: `getActiveWorkspace()` in `src/workspace/active.ts`. Cookie `active_workspace` = slug.
- Config shape: `WorkspaceConfig` in `src/workspace/schema.ts` (brand, business, signals[], pitch, proof[], sampleFeed[]).
- Theme preview: `brandVars(partialBrand)` (`design/brand.ts`) → spread onto a container `style`, or wrap in `<BrandProvider>`.
- P4 feed contract: if active slug is not `eliseai`/`default` and `config.sampleFeed.length > 0`, render sampleFeed; else render the existing practices feed.

## Auth finding (verified 2026-07-11)
- App is NOT globally auth-gated: no middleware, no auth in `app/layout.tsx` / `app/page.tsx`. Read
  pages (feed, prospect, scoreboard, customize) render freely. Only MUTATIONS use `guardMutation`
  (allowlist): send email, feedback, HubSpot connect. `POST /api/workspace/update` and the adapt
  routes are NOT allowlist-gated (they resolve the active workspace server-side).
- Therefore the whole brand-new-tenant path works cookie-based with NO login wall:
  `/welcome` → `/adapt` → reveal (sets cookie) → `/` → `/prospect/[id]` → `/customize` (save works) → `/scoreboard`.
- Real per-tenant auth (a signup that issues a tenant session) = documented roadmap, not tonight.
- Dev server: MUST run `npx next dev --webpack` (the node_modules symlink crashes Turbopack). Never `next build` (disk).

## Discipline
- Phases run SEQUENTIALLY to avoid silent file collisions (autonomous, no human to catch a bad merge).
- Every phase: additive + reversible, EliseAI default path stays green, tsc passes, no `next build` (disk), no em dashes, no hidden errors.
- Verify = e2e in Claude Chrome as a brand-new B2B (non-healthcare) user, end of build.
- Ship = commit in tight chunks, push branch `adapt-it` to origin. NEVER main.
