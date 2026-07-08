# Code review — U6 brief synthesizer

**Branch:** `wave-3-u6` (7 commits on top of `wave-3-u5`) · **Date:** 2026-07-08
**Status:** built, gated, NOT merged, no PR opened.
**Gates:** `npx tsc --noEmit` clean · `npx eslint` clean (0 errors) · `npm test` **705 passed, 2 consecutive full runs**.
**Live path exercised once:** one real Opus 4.8 call, HTTP 200, all three gates passed, **$0.0581**, 28.0s wall.

> **Do not fix anything from this doc in the session that wrote it.** These are recorded, ranked, and
> reproducible. Compact first, then work them in order.

---

## What was verified live, and what that settles

A single real call was made against the golden dermatology practice (`/tmp/smoke.mts`, not committed).
This settles the one risk 705 fake-client tests could not touch: **the request body is accepted by the
real model.**

```
REQUEST KEYS: model, max_tokens, system, thinking, messages, output_config
thinking: {"type":"adaptive"}          <- explicit; omitting it means NO thinking on Opus 4.8
output_config: {"effort":"high","format":{"type":"json_schema",...}}   <- effort INSIDE output_config
sampling params present? none (correct) <- temperature/top_p/top_k are a 400 on this model

HTTP 200. wall: 28.0s
model: claude-opus-4-8 | usage: in 4,091 / out 1,506
cost: $0.0581
SHAPE GATE: pass · CLOSURE GATE: pass (headline cites a signal) · TRUTH GATE: pass
```

**Cost anchor for the CAC scoreboard:** ~**$0.058 per brief** at Opus 4.8 list ($5/$25 per MTok). That is
~6.6× the enrichment extract call ($0.0088, Haiku). 100 practices ≈ $5.81. Output was 1,506 tokens for
~900 tokens of JSON — the balance is adaptive thinking, billed inside `max_tokens` (16k, ample headroom).

---

## Findings, ranked

### F1 — Written-out numbers bypass the truth gate · `CONFIRMED (observed on the live call)`

**Severity: high.** This is the guarantee the unit sells.

`lint.ts#ungroundedNumbers` extracts `\d[\d,]*(?:\.\d+)?` and checks set membership against the evidence.
Number *words* are invisible to it. The limit was recorded in the code as an accepted trade-off — *"false
precision travels as digits"* — and the very first live call disproved that assumption.

The model, constrained by the prompt's digit ban, **spontaneously converted its numbers to words**:

> "Mind if I take **thirty seconds**?"
> "A **fifteen-minute** look at your call flow next week"

Both are benign (they describe *our* ask). The problem is what they demonstrate: the model reaches for the
word form under exactly the pressure that is supposed to stop it. Nothing in the pipeline would stop
`"you're losing forty percent of new patients"` — no digit, so no violation; the sentence can cite a real
review id, so closure passes.

**Reproduce:** `ungroundedNumbers("You lose forty percent of calls.", CORPUS)` → `[]`.

**Fix options (decide, don't guess):**
- **(a) Normalize word-numbers to digits before extraction.** Map `two…ninety-nine`, `hundred`,
  `thousand`, `million`, and `percent`→`%`, then run the existing set check. Leave `one` alone — it is
  overwhelmingly a pronoun ("one thing", "one reply away") and converting it will produce false
  violations. Then extend the meeting-duration exemption to cover the word forms and `second(s)`, or
  the CTA above starts failing.
- **(b) Ban number-words in the prompt and lint them as an `ai-tell`-style list.** Cheaper, blunter;
  it forbids "a fifteen-minute call", which is good copy.

(a) is correct; (b) is a stopgap. Either way `MEETING_DURATION` must be revisited in the same change —
the live CTA "A fifteen-minute look" would be rejected by (a) as written.

---

### F2 — Vague quantifiers overclaim from a single piece of evidence · `CONFIRMED (observed)`

**Severity: medium-high.** It is the failure mode that gets an AE corrected mid-call.

The live opener reads:

> "I saw **a couple of patients** mention they could never get through on the phone"

We supplied **exactly one** review snippet. The sentence cites that review's evidence id, so CLOSURE
passes. It contains no digit, so TRUTH passes. It is still an invented quantity.

No existing gate can see this: it is a claim about *how much* evidence exists, and the gates only check
*that* evidence exists.

**Fix (prompt-first, lint second):**
- Prompt rule: *"Never quantify the evidence. One review is 'a patient wrote', never 'a couple of
  patients'. Say what one source says, or say 'patients' with no count."*
- A narrow lint on evidence-quantifying phrases (`a couple of`, `several`, `a few`, `dozens of`,
  `many of your`) — but scoped to the fields that speak *about the practice* (`headline`, `callOpener`,
  `personalizationSnippet`). Do **not** ban them outright: the live touch-2 body says *"Most practices
  never see the calls that ring out"*, which is a legitimate market generalization, not a claim about
  this clinic.

---

### F3 — Pack ROI benchmarks are in the grounding corpus, so a *modeled* number can be attributed to *this* practice · `PLAUSIBLE (reasoned; the live call did not do it)`

**Severity: medium-high.** It crosses D10's measured-vs-modeled line, which the card renders as a tag.

`inputs.ts#groundingParts` folds `pack.roiBenchmark.items[].label` into the corpus, and the prompt says
`roi benchmarks (numbers here are safe to use)`. Those labels contain `13.4%`, `7.79%`, `$196`, `2,000`.

So a sentence like **"your no-show rate is 13.4%"** passes all three gates: the shape is fine, the opener
can cite the review's evidence id, and `13.4` is in the corpus — because it is a *dermatology-wide
benchmark from a 2020 chart review*, not a measurement of this practice.

The live model behaved correctly and kept benchmarks framed as benchmarks. The guard did not make it do so.

**Fix:** split the corpus by field. Practice-evidence numbers everywhere; pack benchmark/proof numbers
allowed only in `objections[].rebuttal` and `sequence.touches[].body`, where the pack's own framing
survives — never in `headline`, `callOpener`, or `personalizationSnippet`, which speak *about them*.
Change `lintVoice(voice, corpus)` to `lintVoice(voice, { practice, pack })`.

---

### F4 — `citationHref` appends a text fragment to any parseable URL, including non-http(s) schemes · `PLAUSIBLE`

**Severity: low now, latent.** Flagged by the module's author and deliberately not smuggled in.

`URL.canParse("mailto:x@y.com")` is `true`, so a `mailto:` (or worse) source URL gets a fragment. Harmless
today: every `evidence.source_url` is a scraped http(s) page or a detector `redirect_url`. It becomes real
the moment any detector writes a non-http source, because U9 renders these straight into an `<a href>`.

**Fix:** a scheme allowlist (`http:`, `https:`) in `citationHref`, returning the bare `sourceUrl` otherwise
— or, better, at the U9 render boundary where the anchor is actually created. Cheap either way.

---

### F5 — Multiple text blocks would concatenate into invalid JSON · `PLAUSIBLE, benign`

`parseMessagesResponse` joins every top-level `text` block with `"\n"`. Structured outputs return exactly
one, so this never fires; if it ever did, `JSON.parse` fails → SHAPE gate → one retry → honest failure.
Loud, never silent. **Recorded, no action.**

---

### F6 — Adaptive thinking is billed inside `max_tokens` · recorded, not a defect

Measured: 1,506 output tokens for ~900 tokens of JSON. `VOICE_MAX_TOKENS` is 16k, so there is ample room,
and a truncation would surface as a SHAPE failure rather than a half-written brief. Worth watching if the
evidence block grows.

---

## Fixed in this branch (do not re-fix)

Found by probing the guards rather than reading them; each has a test that fails without the fix.

1. **The meeting-duration exemption laundered a statistic.** `"We save 30 minutes call handling time
   daily"` matched a plural-tolerant pattern, so `30` was never checked. A duration adjective is singular
   (`a 15-minute call`); a claim about their time is plural. Unit restricted to `minute|min`. Pinned both
   ways. *(This is the same class of bug as F1 — the guard was narrower than the language.)*
2. **`"holistic"` removed from `AI_TELLS`.** Real healthcare vocabulary; a personalization snippet quoting
   a practice's own "holistic skin care" line would have been rejected, retried, then killed.
3. **`upsertBrief` raced.** SELECT-then-INSERT let two seeders both read "missing", both INSERT, and one
   die on `briefs_practice_id_unique` — *after* paying for its Opus call. Reproduced against the old code
   (`23505 duplicate key`); now one `ON CONFLICT DO UPDATE`, with `regenerated_at` distinguishing the
   branches.
4. **A thrown Anthropic call sank the run**, and `last as AttemptOutcome` was a cast over a possible null.
   Transport failures are now a typed, logged, non-retried gate (answering a 429 with a second immediate
   call buys another 429), and the loop state is seeded rather than cast.

Positive controls run for the three main gates: disabling citation closure, numeric grounding, or
headline-cites-a-signal each fails exactly the test that should catch it, and restoring returns green.

---

## Accepted limits (stated, not hidden)

- **Semantic support is not machine-checked.** The gates prove a claim is *attributed* and that its deep
  link lands on the cited sentence. Whether that sentence *supports* the claim is the human sample review
  at U15. This is the same line `citations.ts` draws.
- **Number words** — see F1. Now known to be exploitable, not theoretical.
- **One live call, n=1.** Voice quality, retry rate, and the truth-gate false-positive rate are unmeasured
  across a cohort. The `meta.attempt` field on every `cost_events` row exists so U15 can measure the retry
  rate for real.
- **`contacts.personalization_snippet` is never written.** U6 keeps the snippet in `briefs.voice`. The
  column stays null. Harmless; noted so nobody reads it expecting content.

---

## Out of scope, flagged for the owner

- **EHR-from-job-postings is NOT built.** See `docs/ehr-signal-recon.md` — measured, not argued: Adzuna
  truncates every description to 500 chars, we store 240, and an EHR is named in **0/20** of the detector's
  own results. The unlock is a *search-side* U4 change (Adzuna's index covers the full posting: 201 ModMed,
  610 Nextech, 1,396 eClinicalWorks US postings), plus a one-character slice bump, plus an authored alias
  field on the pack schema. Cheap, valuable, and not U6's.
- **`vitest.config.ts` was changed** (`maxWorkers: 4`, `hookTimeout: 30s`) — outside U6's file list, and
  deliberate. Two consecutive full runs had failed 26 and 33 tests, every one `Hook timed out in 10000ms`
  in a PGlite suite. The suite was already at that edge; U6's 138 tests pushed it over. `npm test` is the
  ship gate, and a gate that fails half its runs is not a gate. Three consecutive green runs after.
- **This worktree's `.env.local` is a partial copy** — it carries the stale `JOBS_API_KEY` and is missing
  `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` (they live in the main clone). A live detector run from
  `bme-wave-3-u5` would silently emit zero staffing-spike candidates.
- **Two commits by Lilly landed inside `wave-3-u6` mid-session** (`421b7c4`, `a54e5b8`, both `src/enrich/`
  + docs). They do not touch `src/brief/`. A U6 PR would carry them. Worth deciding whether to rebase them
  onto `wave-3-u5` first.

---

## Appendix — the brief the live call actually produced

Kept because F1 and F2 are only visible in it.

```
HEADLINE: Patients say they can't get through, and you're hiring to answer the phones
OPENER:   Dr. Schlessinger, I saw a couple of patients mention they could never get through
          on the phone, always on hold. And you're hiring a coordinator to answer calls and
          manage the schedule. Figured your front desk is underwater right now, not
          underperforming. Mind if I take thirty seconds?
CTA:      A fifteen-minute look at your call flow next week
OBJ1:     "We're already hiring someone for the phones."
       -> "Makes sense, you need the coverage. The catch is derm groups often can't staff
           their way out around screening season. The practices winning aren't adding
           headcount, they're making sure zero new-patient calls ring out."
```

`a couple of patients` (F2) from one review. `thirty seconds` and `fifteen-minute` (F1) as words.
Everything else — opens in their world, quotes the review verbatim, names the pain in the pack's
vocabulary, teaches, one ask, graceful exit — is what the prompt asked for and got.
