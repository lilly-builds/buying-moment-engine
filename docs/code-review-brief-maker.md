# Code review — U6 brief synthesizer

**Branch:** `wave-3-u6` (17 commits on top of `wave-3-u5`) · **Date:** 2026-07-08
**Status:** built and gated. **All P1/P2/P3 findings below are FIXED** (see Resolution). Still NOT merged,
no PR opened — a human opens the PR.
**Gates:** `tsc --noEmit` clean · `eslint` clean (0 errors) · `npm test` **740 passed, consecutive full runs**.
**Live path re-verified on the streaming build:** real Opus 4.8 calls — HTTP 200, `stream:true` +
structured outputs accepted, priced correctly, all three gates pass on the first attempt, **~$0.059**, ~24s.
**Fresh-eyes review:** a skeptic subagent that did not write the code reviewed `b37ddb9` and reproduced
**five** defects; the live call and a re-read surfaced four more. All nine are addressed below.

---

## Resolution (2026-07-08) — all findings fixed, after compaction

Fixed in six focused commits on `wave-3-u6`, each carrying a test that FAILS without it. Positive controls
were re-run by reverting the guard in isolation: P1-1, P1-3 and P2-7 each fail their new tests when the fix
is neutered and pass when restored.

| Finding | Fix commit | The guard that now holds |
|---|---|---|
| **P1-1** | `5fde3e0` | Closure gate rejects `factual.zeroSignal !== (voice.headline === null)`, both directions. Render belt resolves the headline on `factual.zeroSignal`, not on the model's prose. |
| **P1-2** | `5fde3e0`, `aaa70d8` | `renderBrief` shows the headline only while one of its `headlineEvidenceIds` is still a fresh signal (the render-time mirror of `headlineCitesASignal`), else the constant. Exposes `stale`. The follow-up closed the *partial-expiry* hole a count-only check missed. |
| **P1-3** | `124637b` | Corpus split: pack numbers ground ONLY `objections[].rebuttal`; a pack number anywhere else is `ungrounded-number`. `personalizationSnippet` must cite ≥1 evidence id. |
| **P2-4** | `d221896` | `stream: true`; the voice client folds a mid-body abort into a priced response. The transport-gate comment is corrected — streaming is what makes "a throw is unbilled" true. |
| **P2-5** | `124637b` | `groundingParts(input, freshSignals)` — an expired signal's digits no longer ground prose. `ehrSignals[].name` and the `website` URL value dropped from the corpus. |
| **P2-6** | `71ad428` | `MEETING_DURATION` allowlists proposal lengths (10/15/20/25/30/45/60); "a 12 minute call" is now caught. |
| **P2-7** | `71ad428` | `wordNumbersToDigits` folds spelled-out numbers to digits before extraction, on both prose and corpus; "forty percent" is caught, "one" and ordinals are left alone. Our-ask durations (minutes and seconds, word or digit) stay exempt. |
| **P2-8** | `496b995`, `aaa70d8` | Prompt rule forbids quantifying the evidence; a narrow `vague-quantifier` lint on headline/callOpener/personalizationSnippet. The follow-up exempts a vague *time-ask* ("a few minutes") so a CTA does not cost a retry. |
| **P3-9** | `9a657d6` | `citationHref` deep-links only http(s) sources; a mailto/tel/ftp source degrades to the bare link. |

**Fresh-eyes verification.** A second skeptic pass (that did not write the fixes) reviewed the whole fix
diff and returned **SHIP**. It confirmed the P1s and P2s are correctly closed, and found two residuals,
both now handled in `aaa70d8`: **finding 1** — the P1-2 belt keyed on `signalCount === 0` and so still
showed a headline whose *own* signal had expired while an unrelated one kept the count at 1 (a real KTD
violation, now fixed); **finding 3** — a vague time-ask tripped the P2-8 lint (a false positive, now
exempted).

**Verified live (finding 4, now closed).** Several real streamed Opus 4.8 calls against a synthetic
dermatology practice: `stream: true` alongside `output_config.format` is accepted, the SSE parses to valid
structured JSON, and the call is priced correctly (no `unpricedReason`, no `streamError`) — ~$0.059, ~24s,
in ~4,300 / out ~1,500. The very first call also **proved the P1-3 corpus split against the real model**:
unprompted, it wrote the pack's `2,000 / 250 / 130` into a touch body, and the truth gate rejected them.

That live call surfaced two follow-ups, both fixed in `056db80`:
- **Tokenizer false-positive.** `NUMBER_TOKEN` greedily kept a trailing comma, so "since 2004, and…" read
  as `"2004,"` and failed to match the grounded `"2004"` — a true fact wrongly rejected. Fixed to
  `\d+(?:\.\d+)?` (digit-grouping commas are already stripped upstream). Re-verified live: "served Omaha
  since 2004," is no longer flagged.
- **Prompt/lint disagreement.** The corpus split confined the pack's proof/ROI figures to a rebuttal, but
  the prompt still told the model those numbers were "safe to use" and to lead touch 2 with the proof
  point — so a compliant brief failed truth and burned a retry. The prompt now says the pack's figures may
  be quoted ONLY in a rebuttal; elsewhere the proof is told without its numbers. Re-verified live: a fresh
  brief leads touch 2 with the proof *story*, no figures, and passes all three gates on attempt 1.

**One accepted residual (finding 2), not a blocker.** An allowlisted meeting length + a session noun
("a 15-minute call") is exempt from the number gate regardless of whose meeting it is, so "your team burns
a 15-minute call on every reschedule" is not flagged. Strictly narrower than the pre-P2-6 behaviour and the
tradeoff the review chose; distinguishing our proposal from their statistic needs subject/verb parsing, out
of scope for U6. Semantic support is the human sample review at U15.

The nine findings below are the ORIGINAL review, kept verbatim for the record. Read them for the
reproductions and the reasoning; the tables above are the current state.

---

## What the live call settles

One real call against the golden dermatology practice. This closes the one risk 705 fake-client tests
could not touch: **the request body is accepted by the real model.**

```
thinking: {"type":"adaptive"}            <- explicit; omitting it means NO thinking on Opus 4.8
output_config: {"effort":"high","format":{"type":"json_schema",...}}   <- effort INSIDE output_config
sampling params: none                    <- temperature/top_p/top_k are a 400 on this model

HTTP 200 · 28.0s · model claude-opus-4-8 · in 4,091 / out 1,506 · $0.0581
SHAPE pass · CLOSURE pass (headline cites a signal) · TRUTH pass
```

**CAC anchor:** ~**$0.058 per brief** (Opus 4.8 list, $5/$25 per MTok) — ~6.6× the Haiku extract call
($0.0088). 100 practices ≈ $5.81. Output was 1,506 tokens for ~900 tokens of JSON; the balance is adaptive
thinking, billed inside `max_tokens` (16k, ample headroom).

## What the review confirmed is sound

`citation-link.ts` survived 13 hostile inputs (existing `:~:` directive, `#` in query, `&`/`,`/`-` in the
snippet, lone surrogates, whitespace-only snippet, unparseable URL) — each either deep-links correctly or
degrades to the exact page. No injection, no wrong-destination navigation. `signalFingerprint` sorts stably
and handles one kind firing twice. The retry loop cannot persist a brief that failed a gate, and cannot
exceed two paid calls.

---

# P1 — must fix before merge

### P1-1 · A zero-signal brief can render an invented buying moment, citing nothing
`src/brief/synthesize.ts:197`, `src/brief/render.ts:129` · **CONFIRMED (reproduced)**

`headlineMissesSignal` short-circuits on `!factual.zeroSignal`, so on a zero-signal practice **nothing
checks that the model returned `headline: null`.** `renderBrief` then prefers `voice.headline` over
`factual.headline`.

Zero signals; model returns `headline: "They just opened a second location"`, `headlineEvidenceIds: []`.
SHAPE passes (a string is valid). CLOSURE passes (`[] ⊆ allowed`, and the signal check is skipped). TRUTH
passes (no digits, no tells). Persisted. Rendered:

```
headline: "They just opened a second location"     live.signalCount: 0
factual.headline: "No buying moment detected yet"  zeroSignal: true
```

The inverse also passes: two signals firing, model returns `headline: null` while citing a signal id →
card reads "No buying moment detected yet" over `signalCount: 2`.

**Violates** R5/D2 (uncited claim) and U8's zero-signal variant.
**Fix:** in `attemptVoice`, before the closure return, reject when
`factual.zeroSignal !== (voice.headline === null)`, with a correction line. Belt: `renderBrief` resolves
`brief.factual.zeroSignal ? ZERO_SIGNAL_HEADLINE : (brief.voice.headline ?? ZERO_SIGNAL_HEADLINE)`.

---

### P1-2 · The card still claims a buying moment after every signal has expired
`src/brief/render.ts:129` · **CONFIRMED (reproduced)**

Generate at `NOW`, render at `2026-10-01` (past both expiries):

```
headline: "They are hiring for the front desk right now"
live: signalCount 0, freshness null, firedSignals 0
isBriefStale(...): true          <- correct, and nobody calls it
```

`render.ts`'s own header defends only the *count* ("still says '3 signals firing' on Friday"). The headline
is the louder claim and is not defended at all. `RenderedBrief` exposes no staleness field, so a UI has
nothing to gate on.

**Violates** the KTD verbatim: *"a stored brief must never claim a buying moment that has expired."*
**Fix:** `renderBrief` computes `isBriefStale(...)`, adds it to `RenderedBrief`, and falls back to
`ZERO_SIGNAL_HEADLINE` when `live.signalCount === 0`.

---

### P1-3 · The pack's own numbers launder a fabricated, uncited fact about *this* practice
`src/brief/schema.ts:200`, `src/brief/inputs.ts:277-280` · **CONFIRMED (reproduced)**

Two holes compose into one:

1. `const evidenceIds = z.array(z.uuid())` has **no `.min(1)`**, so `evidenceIds: []` satisfies citation
   closure trivially.
2. `groundingParts` folds the pack's proof metrics and ROI labels into the corpus — for dermatology that
   donates `2000`, `600`, `250`, `130`, `13.4`, `196`, `5315`.

So a touch body of *"You are fielding roughly 2,000 calls a month and losing 250 new patients to
voicemail"* with `evidenceIds: []` passes SHAPE, CLOSURE **and** TRUTH, and persists. Both numbers belong
to *Texas Dermatology* — the pack's case study — and the sentence asserts them about the prospect.

This is precisely the invariant `schema.ts`'s header claims to enforce ("a voice field that asserts
something about the practice must name an evidence id from its own input"). It does not. **A docstring
asserting a guarantee the code does not enforce is worse than no docstring.**

**Violates** R5/D2, and crosses D10's measured-vs-modeled line.
**Fix:** split `groundingParts` into `evidenceNumbers` (practice name/city/state, `fact.value`,
fresh-signal snippets) and `packNumbers`. In `lintVoice`, a token grounded *only* by `packNumbers` is an
`ungrounded-number` violation **unless** the field is an `objections[].rebuttal` — the one place the system
prompt permits the pack's proof. Separately, require `≥1` evidence id on any voice field that asserts
something about the practice. The golden fixture stays green.

---

# P2 — fix before the U15 seeding run

### P2-4 · A billed Opus timeout writes no `cost_events` row, and the transport gate mislabels it "unbilled"
`src/brief/voice.ts:120-132,157`, `src/brief/synthesize.ts:135` · **PLAUSIBLE (reasoned; a real network timeout was not forced)**

`buildVoiceRequestBody` sets no `stream: true`, with `max_tokens: 16_000`, adaptive thinking, `effort:
"high"`. A non-streamed Messages response emits no headers until generation finishes, so
`AbortSignal.timeout(120_000)` fires on the `fetch()` promise itself — **before** `res.ok`, before
`readJsonBody`, before the meter's `recorder.record`. The call was billed. The ledger says $0.

This repo has already paid for this exact bug once. `src/enrich/anthropic-client.ts:179-183` documents it
(the `westlake-dermatology` row: billed ~$1.27, recorded $0.00) and solved it with `stream: true`.

**And my `transport` gate made the reporting worse.** `synthesize.ts:135` asserts *"A THROWN call was never
billed — a 429, a timeout, a socket that died before headers."* That is true of a 429. It is **false** of a
16k-token Opus abort. What used to crash loudly now silently understates CAC. The comment is wrong and must
change with the code.

**Violates** R19.
**Fix:** `stream: true` in `buildVoiceRequestBody`, reusing `consumeSseStream` / `streamToResponse` exactly
as `anthropicResearchClient` does. (If streaming is off the table: catch the abort in
`anthropicVoiceClient` and resolve `{text:"", usage: ZERO_USAGE, model: VOICE_MODEL, unpricedReason:
"aborted-after-request"}` — and then the transport gate must stop claiming aborts are unbilled.)

---

### P2-5 · The grounding corpus is wider than what the model was shown
`src/brief/synthesize.ts:213`, `src/brief/inputs.ts:273` · **CONFIRMED (reproduced)**

`assembleFactual` filters to `freshSignals` and `attemptVoice` passes that filtered array to `runVoice`.
Gate 3 then calls `groundingParts(input)`, which maps over **`input.signals`** — the *unfiltered* set. A
digit that exists only in an **expired** signal's snippet grounds prose the model never saw.

`lint.ts:190-193` states the invariant out loud: *"Built from the SAME inputs the model was shown… Wider
than the model's input and a fabrication passes."* The corpus is wider.

Same function also donates `pack.ehrSignals[].name` (never shown to the model) and, for
`field === "website"`, a **URL** — the precise digit-laundering hazard the function's own docstring
excludes contact email and LinkedIn for.

**Fix:** `groundingParts(input, signals)` taking the fresh array explicitly, or `groundingParts({...input,
signals})` at the call site. Drop `ehrSignals` and the `website` fact value from the parts list.

---

### P2-6 · `MEETING_DURATION` still launders a duration about the prospect
`src/brief/lint.ts:169-170` · **CONFIRMED (reproduced)**

The singular-unit tightening (committed in `b37ddb9`) stops `"30 minutes call handling"`. It does not stop
a fabricated duration that happens to be grammatical:

```
"Patients sit through a 12 minute call before anyone picks up."  -> []   (no violation)
"Every new patient waits on a 9 minute call."                    -> []
"Your team burns a 7 minute call on every reschedule."           -> []
```

The exemption keys on **grammar**, not on **whose meeting it is**. The file's claim that narrowness "is the
whole safety argument" does not hold.

**Fix:** allowlist the proposal lengths — `\b(?:10|15|20|25|30|45|60)\s?-?\s?(?:minute|min)\s+(?:call|chat|…)\b`.
Kills 12/9/7; keeps every case the existing tests pin.

---

### P2-7 · Written-out numbers bypass the truth gate entirely
`src/brief/lint.ts#ungroundedNumbers` · **CONFIRMED (observed on the live call)**

`ungroundedNumbers` extracts `\d[\d,]*(?:\.\d+)?`. Number **words** are invisible. The code recorded this as
an accepted trade-off — *"false precision travels as digits"* — and **the first live call disproved it.**
Constrained by the prompt's digit ban, the model spontaneously converted its numbers to words:

> "Mind if I take **thirty seconds**?" · "A **fifteen-minute** look at your call flow"

Both are benign — they describe *our* ask. What they demonstrate is not: the model reaches for the word form
under exactly the pressure meant to stop it. Nothing would stop *"you're losing forty percent of new
patients."*

**Reproduce:** `ungroundedNumbers("You lose forty percent of calls.", CORPUS)` → `[]`.
**Fix:** normalize word-numbers (`two`…`ninety-nine`, `hundred`, `thousand`, `million`, `percent`→`%`) to
digits before extraction, then run the existing set check. Leave `one` alone — it is overwhelmingly a
pronoun ("one thing", "one reply away"). Extend the meeting-duration exemption to the word forms and
`second(s)` in the same change, or the live CTA above starts failing.

---

### P2-8 · Vague quantifiers overclaim from a single piece of evidence
`src/brief/prompts/voice.ts` + `lint.ts` · **CONFIRMED (observed on the live call)**

The live opener reads:

> "I saw **a couple of patients** mention they could never get through on the phone"

We supplied **exactly one** review. The sentence cites that review's evidence id, so CLOSURE passes; no
digit, so TRUTH passes. It is still an invented quantity. No gate can see it: the gates check *that*
evidence exists, never *how much*.

**Fix (prompt-first, lint second):** prompt rule — *"Never quantify the evidence. One review is 'a patient
wrote', never 'a couple of patients'."* Then a narrow lint on `a couple of` / `several` / `a few` /
`dozens of` / `many of your`, scoped to the fields that speak *about the practice* (`headline`,
`callOpener`, `personalizationSnippet`). Do **not** ban them outright — the live touch-2 body says *"Most
practices never see the calls that ring out,"* a legitimate market generalization.

---

# P3 — latent, cheap

### P3-9 · `citationHref` appends a fragment to any parseable URL, including non-http(s)
`src/brief/citation-link.ts` · **PLAUSIBLE**

`URL.canParse("mailto:x@y.com")` is `true`. Harmless today — every `evidence.source_url` is a scraped
http(s) page or a detector `redirect_url` — but U9 renders these straight into an `<a href>`. Becomes real
the moment any detector writes a non-http source.
**Fix:** scheme allowlist (`http:`, `https:`) in `citationHref`, or at the U9 render boundary.

### P3-10 · Multiple text blocks would concatenate into invalid JSON — benign
`parseMessagesResponse` joins every top-level `text` block with `"\n"`. Structured outputs return exactly
one. If two ever appeared, `JSON.parse` fails → SHAPE gate → one retry → honest failure. Loud, never
silent. **Recorded, no action.**

---

## Fixed in this branch (do not re-fix)

Each has a test that fails without the fix.

1. **The meeting-duration exemption laundered a statistic.** `"We save 30 minutes call handling time
   daily"` matched a plural-tolerant pattern, so `30` was never checked. Unit restricted to `minute|min`.
   *(Incomplete — see P2-6.)*
2. **`"holistic"` removed from `AI_TELLS`** — real healthcare vocabulary; would have killed a true
   personalization snippet.
3. **`upsertBrief` raced.** SELECT-then-INSERT let two seeders both read "missing", both INSERT, and one die
   on `briefs_practice_id_unique` — *after* paying for its Opus call. Reproduced against the old code
   (`23505 duplicate key`); now one `ON CONFLICT DO UPDATE`.
4. **A thrown Anthropic call sank the run**, and `last as AttemptOutcome` was a cast over a possible null.
   Now a typed, logged, non-retried `transport` gate. *(Its "unbilled" claim is wrong — see P2-4.)*

Positive controls run: disabling citation closure, numeric grounding, or headline-cites-a-signal each fails
exactly the test that should catch it, and restoring returns green.

---

## Accepted limits (stated, not hidden)

- **Semantic support is not machine-checked.** The gates prove a claim is *attributed* and that its deep
  link lands on the cited sentence. Whether that sentence *supports* the claim is the human sample review
  at U15 — the same line `citations.ts` draws.
- **One live call, n=1.** Voice quality, retry rate, and truth-gate false-positive rate are unmeasured
  across a cohort. `meta.attempt` on every `cost_events` row exists so U15 can measure the retry rate for
  real.
- **`contacts.personalization_snippet` is never written.** U6 keeps the snippet in `briefs.voice`; the
  column stays null. Noted so nobody reads it expecting content.

---

## Out of scope, flagged for the owner

- **EHR-from-job-postings is NOT built.** See `docs/ehr-signal-recon.md` — measured, not argued: Adzuna
  truncates every description to 500 chars, we store 240, and an EHR is named in **0/20** of the detector's
  own results. The unlock is a *search-side* U4 change (Adzuna's index covers the full posting: 201 ModMed,
  610 Nextech, 1,396 eClinicalWorks US postings), plus a one-character slice bump, plus an authored alias
  field on the pack schema.
- **`vitest.config.ts` was changed** (`maxWorkers: 4`, `hookTimeout: 30s`) — outside U6's file list, and
  deliberate. Two consecutive full runs had failed 26 and 33 tests, every one `Hook timed out in 10000ms` in
  a PGlite suite. The suite was already at that edge; U6's 138 tests pushed it over. Three consecutive green
  runs after.
- **This worktree's `.env.local` is a partial copy** — stale `JOBS_API_KEY`, missing `ADZUNA_APP_ID` /
  `ADZUNA_APP_KEY` (they live in the main clone). A live detector run from `bme-wave-3-u5` would silently
  emit zero staffing-spike candidates.
- **Two commits by Lilly landed inside `wave-3-u6` mid-session** (`421b7c4`, `a54e5b8` — both `src/enrich/`
  + docs; they do not touch `src/brief/`). A U6 PR would carry them. Decide whether to rebase them onto
  `wave-3-u5` first.

---

## Appendix — the brief the live call actually produced

Kept because P2-7 and P2-8 are only visible in it.

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

`a couple of patients` (P2-8) from one review. `thirty seconds` / `fifteen-minute` (P2-7) as words.
Everything else — opens in their world, quotes the review verbatim, names the pain in the pack's own
vocabulary, teaches, one ask, graceful exit — is what the prompt asked for, and got.
