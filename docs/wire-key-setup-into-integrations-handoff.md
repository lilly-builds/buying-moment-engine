# Wire the key-setup help into the Integrations page — Dev Handoff

**Purpose:** put the "get your Anthropic/PDL key" help — the copy-paste **Claude in
Chrome** prompt + the written do-it-yourself steps — neatly onto the `/integrations`
page, under each engine-key card. So a non-technical RevOps owner never has to hunt
through an unfamiliar dashboard to find an API key.

**Status:** the *content* is done and verified (against the live dashboards,
2026-07-10) and lives in two places already:
- **`src/connect/setup-prompts.ts`** → `KEY_SETUPS` — the canonical, machine-readable
  copy (the Chrome prompt + the manual steps + the sign-in note + the direct key URL,
  per provider). **This is the source of truth — import it verbatim; do NOT retype the
  prompts** (the wording is load-bearing).
- **`docs/revops-connections-guide.md`** — the human-readable mirror (same prompts +
  steps), for anyone reading a doc instead of the app.

What's left is the **UI wiring** — this handoff.

---

## Path (1) — DEV handoff: paste into a fresh Claude Code session

```text
Task: Wire the BYOK key-setup help into the /integrations page UI (U17 follow-up).

Repo: ~/Developer/buying-moment-engine. Work the spine (SCOPE→BUILD→VERIFY→REVIEW→SHIP)
in an isolated worktree off latest main. Read AGENTS.md first (this is a MODIFIED
Next.js — read node_modules/next/dist/docs/ before writing app code).

Context — the content already exists, DON'T rewrite it:
- src/connect/setup-prompts.ts exports KEY_SETUPS[{anthropic,pdl}], each with:
  { keyUrl, signIn, chromePrompt, manualSteps[] }. Import and render these VERBATIM.
  The chromePrompt wording is load-bearing (it tells Claude to stop before the key and
  never read/copy/type it) — never edit that safety line.
- The engine-key cards live in app/integrations/integrations-view.tsx, component
  `EngineKeyCard` (the masked paste field + Save, already shipped). Add the help INSIDE
  each card, below the existing form.

BUILD:
1. Under each EngineKeyCard, add a collapsed-by-default "Don't have a key yet?" toggle
   that expands to two options, from KEY_SETUPS[meta.id]:
   (a) "Let Claude get it for you" — render `chromePrompt` in a read-only, scrollable
       box (whitespace-pre-wrap) + a "Copy prompt" button (navigator.clipboard, with a
       transient "Copied" state). Show `signIn` as a muted line. Add a one-line link to
       install the extension: https://support.anthropic.com/en/articles/12012173-getting-started-with-claude-for-chrome
   (b) "Or do it yourself" — render `manualSteps` as an ordered list.
2. Fix the two stale entries in the ENGINE_KEYS array in the same file to match the
   verified copy in KEY_SETUPS:
   - anthropic: href → https://platform.claude.com/settings/keys ; where → "Claude
     Console → Create key" (the old console.anthropic.com link merely redirects).
   - pdl: href → https://dashboard.peopledatalabs.com ; where → "PDL dashboard → My API
     Key → Copy" (the old .../api-keys path is an API endpoint, not a page — it 401s).

Design (match the existing kit — design/components, design/rules.ts):
- Use Button/Card/etc. from @/design/components; no hand-rolled styled elements.
- Collapsed by default so it never crowds someone who already has a key.
- The prompt box must scroll inside itself (overflow-auto, max-height) — never make the
  card grow unbounded or the page scroll sideways. Responsive at mobile + desktop.
- Keep it a calm secondary surface; the paste field stays the primary action.

Guardrails:
- The key is a SECRET. Nothing here ever displays, logs, or transmits a real key; this
  is just help text + a copy-to-clipboard of a PROMPT. Don't touch the /api/provider-keys
  route or the crypto.
- Small single-responsibility components; keep the file readable.
- VERIFY by rendering /styleguide/integrations (public in dev): expand the toggle, copy
  the prompt, confirm both provider cards read correctly and nothing overflows at mobile
  width. (Tip: `next dev --webpack` if node_modules is symlinked across worktrees —
  turbopack rejects the out-of-root symlink.)
- When green (typecheck + lint + the relevant tests), open a PR to main and report.
  Do NOT merge.
```

---

## Path (2) — prefer to build it yourself? The spec

Same as Path (1), by hand:
1. **Source of truth:** `src/connect/setup-prompts.ts` (`KEY_SETUPS`). Import it; render
   `chromePrompt`, `manualSteps`, `signIn` per provider. Don't duplicate the strings.
2. **Where:** `app/integrations/integrations-view.tsx` → inside `EngineKeyCard`, below the
   form. A collapsed "Don't have a key yet?" disclosure → (a) Claude-prompt copy box +
   "Copy prompt" button + the extension-install link, (b) the manual `manualSteps` list.
3. **Fix** the two stale `ENGINE_KEYS` URLs/labels (see the verified values above).
4. **Extension link** (surface it in option (a) so a user can install Claude in Chrome):
   [Get started with Claude in Chrome](https://support.anthropic.com/en/articles/12012173-getting-started-with-claude-for-chrome)
   · overview [claude.com/claude-for-chrome](https://claude.com/claude-for-chrome).

---

## Why this shape (the judgment to preserve)

- **Two ways, always.** "Let Claude do it" for the non-technical owner; "do it yourself"
  so nobody is blocked without the extension. Mirrors the HubSpot handoff's paths.
- **Claude drives *to* the key, never *takes* it.** The prompt stops at the create/copy
  step and hands the last click to the human, because an API key is a secret Claude must
  never read, copy, or type. This is a safety contract — keep that line exactly.
- **One source of truth.** The prompt wording is verified against the real dashboards; a
  retyped copy that drifts would send users to the wrong button. Import `KEY_SETUPS`.
