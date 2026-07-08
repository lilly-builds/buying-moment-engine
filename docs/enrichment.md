# Enrichment — how a practice becomes a cited brief

`scrape → extract → verify → PDL gap-fill → persist`

Every claim on this page is labelled `verified (n=…)` or `inferred`. Nothing here is an estimate wearing a number's clothes.

---

## The method

1. **Scrape** the practice's own website (`src/enrich/scrape.ts`). Fetch `robots.txt` once per origin, then the homepage; discover same-host links with `cheerio` and bucket them by keyword — `team · about · locations · services · patients · careers · news`. Fetch the best match per bucket, in parallel, skipping any path `robots.txt` disallows. Clean each page to text (`html-clean.ts`).

   The result is a **`Map<absoluteUrl, cleanedText>`** — never a flattened blob. The URL key *is* the provenance; join the pages together and all you can prove is that a sentence exists *somewhere*.

2. **Extract** (`src/enrich/extract.ts`). One **Claude Haiku 4.5** call over the text we already hold, with structured outputs (`output_config.format`). The user message is a sequence of `=== SOURCE: <absoluteUrl> ===` blocks, so the model is physically unable to cite a page we do not have — no other URL appears in its context.

3. **Verify** (`src/enrich/citations.ts`). Every fact arrives as `{value, sourceUrl, snippet}` — `snippet` is the exhibit, `value` is what the brief renders. Three gates, in order:

   1. **Do we hold the cited page?** If not → `url-not-held`. The model was shown every URL it was allowed to cite.
   2. **Is the snippet on that page**, contiguously, after normalizing *both sides* identically (lowercase · collapse whitespace runs · curly quotes → straight · en/em-dash → hyphen)? If not → `snippet-not-verbatim`.
   3. **Does the snippet contain the value**, as a whole word or phrase? If not → `value-not-in-snippet`.

   Gate 3 runs only on **quotation** fields, where the value is a span lifted off the page (`ehr`, `incumbentTooling`, `yearFounded`, the decision-maker's `name` / `role` / `email`). It cannot run on **label** fields, where the value is the model's own word for what the snippet says (`specialty` — "Orthopedics" for "…orthopedic practice"; `website`; `linkedinUrl`; `buyingMomentContext`). Those are kept, and reported in `VerificationResult.paraphrased` so the brief never renders one inside quote marks. See [Limits](#limits-of-the-citation-check).

   A fact that fails any gate is **dropped**, and the drop is returned and logged with its field, reason, value and snippet — never swallowed.

4. **PDL gap-fill** (`src/enrich/pdl.ts`). Called *only* for the fields the extractor left blank *and* the stored contact cannot already fill — a practice whose staff page publishes the manager's name, email and LinkedIn makes **zero** PDL calls, and so does a re-run.

5. **Persist.** Only verified facts reach `practice_facts`, each with its own evidence row carrying `source_url`, `snippet` and `detected_at`.

An **agentic fallback** (Sonnet 5, server-side `web_search` + `web_fetch`) is retained for practices whose site we cannot read. It fires on a *bad result* — a thin scrape, an unparseable body, or zero verified facts — never on a thrown error, and it is capped by a run-wide spend budget. See [Escalation](#escalation).

---

## Why hold the page: D2 became a test

The requirement (D2 / R5) is *"the brief never states an uncited fact."*

Before this refactor, that was enforced by a schema that checked a fact **has** a `sourceUrl` and a `snippet` — never that the snippet is on that page. It *could not be*: the old mechanism let Claude browse, and we never held the bytes it read. A snippet stitched together from three separate parts of a page arrived carrying a real URL and looking exactly like a quotation.

Holding the page makes the check arithmetic. It has caught fabrication **four times**:

| when | practice | field | what happened |
|---|---|---|---|
| prompt experiment, round 1 | schlessinger-md-dermatology | `providerCount` | three names that appear on the team page as three separate `<h2>` headings, comma-joined into a sentence that appears nowhere |
| prompt experiment, round 2 | virginia-womens-center | `locationsCount` | stitched from a location list |
| live production path | schlessinger-md-dermatology | `firmographics.website` | `snippet-not-verbatim` |
| **live, again** | schlessinger-md-dermatology | `firmographics.website` | `snippet-not-verbatim` — the same field, on a later run |

**And the same call, repeated, does not fabricate every time.** That third catch was re-run immediately on *identical* input (8,274 tokens — the scrape is deterministic) and produced *different* output (366 vs 352 tokens) with **zero drops**. It then fired again on the fourth run. `verified (n=3 calls on identical input: caught · clean · caught)`.

So the fabrication is **stochastic**. Same page text, same prompt: the model stitches a snippet on one call and not the next. A defect that only appears *sometimes* cannot be caught by reading the output, by a model's self-reported confidence score, or by tightening the prompt — those all inspect one sample. It can only be caught by holding the page, on every call.

*(This is also why "we re-ran it and it was fine" is not evidence of anything. A stochastic defect is only ever absent from the sample you happened to look at.)*

`tests/enrich/citations.test.ts` pins the round-1 catch against the real captured team-page text. Delete the verifier and that test goes red — that is the proof D2 is enforced rather than requested.

### Derived counts are not citable facts

`locationsCount` and `providerCount` are **tallies**, and a tally has no contiguous sentence that proves it. The only way a model can produce a snippet for one is by stitching. Both prompt-experiment catches were exactly those two fields.

They are no longer LLM-cited fields at all. The model cites what a page *states* (`specialty`, `website`, `yearFounded`); code counts what must be counted.

---

## Scraper etiquette — the tradeoff was measured and found not to exist

We identify ourselves honestly and obey `robots.txt`. This costs nothing:

| approach | cohort homepages returning 200 |
|---|---|
| Spoofed Chrome UA | 10 / 10 |
| **Honest UA** — `BuyingMomentEngine/1.0 (+https://github.com/lilly-builds/buying-moment-engine)` | **10 / 10** |

And **0 / 10** cohort domains' `robots.txt` disallows any path we crawl. `verified (n=10)`.

There is zero recall cost to the clean option, so we take it. Read-only public business pages. No login walls, no forms, no patient data, nothing is ever contacted.

`Allow:` directives are deliberately unimplemented — ignoring one can only ever make us *skip* a page, never crawl a forbidden one.

### A redirect can move the origin under you

`fetch(…, {redirect: "follow"})` hands back a 200 that may have come from a host you never asked about — and whose `robots.txt` you have therefore never read. An acquired practice's domain 301s to its parent DSO; the DSO disallows `/locations/`; we follow, take the body, and hold it. The old code discarded `res.url`, so it could not even tell.

So the scraper reads `res.url`. If the homepage lands on a different origin, it **re-fetches that origin's `robots.txt`**, re-checks the landed path against it, and re-bases both link discovery and the page keys onto the host that actually served the text. Per-page, a bucket page that redirects off-origin is dropped rather than held under a URL that does not serve it.

It is **not** treated as `blocked`: `https://toa.com/` → `https://www.toa.com` is everyday, and refusing it "to be safe" would silently delete real practices. `robots.txt` itself still follows redirects without re-basing — RFC 9309 §2.3.1.2 says a redirected `robots.txt` governs the authority that was asked.

Covered by `tests/enrich/scrape.test.ts`, asserting on the *fetcher's call list* — "we obeyed the rules" is a claim about the requests we made, not the bytes we kept. Honest limit: **no practice in the live cohort cross-origin redirects**, so this path is proven by tests, not by the wild. What the live run does show is that it cost nothing: pages held per practice are identical before and after (6·7·5·5·3).

---

## Cost and latency · `verified (n=5 practices, 2026-07-08)`

*Figures below are the A/B against the agentic mechanism, measured before the value gate landed. The gate added a fixed 521 input tokens per practice — current mean is **$0.0094**, and the comparison is unchanged at three significant figures. See [What the tightened check cost](#what-the-tightened-check-cost--verified-n5-practices-2026-07-08).*

| | agentic (old) | scrape → extract |
|---|---|---|
| input tokens / practice | 357,500 | 4,941 – 10,470 |
| cost / practice | **$1.27** | **$0.0064 – $0.0119** (mean $0.0088) |
| wall / practice | 4–5 min | 3.4 – 22.4 s (mean 10.1 s) |
| calls that died | 1 in 3 | 0 in 5 |

Same practices, both architectures — a true A/B, not a new cohort:

| practice | agentic | scrape → extract | |
|---|---|---|---|
| `schlessinger-md-dermatology` | $1.2892 | $0.0100 | 128.9× |
| `charleston-womens-wellness` | $1.2475 | $0.0064 | 194.9× |
| `westlake-dermatology` | **$0.0000** | $0.0092 | — |

Aggregate over the two comparable pairs: **154.7× cheaper**. Every cost row was hand-checked against the published rate card ($1 / $5 per MTok on Haiku 4.5): 5/5 exact. Cost is a deterministic function of tokens.

The 22.4s outlier was the run's **first** call. Structured outputs pay a one-time schema-compilation cost and then cache for 24h; the other four calls averaged 4.8s of extraction. Consistent — but `inferred`, because no cold-schema control was run.

### `westlake-dermatology` recorded `$0.0000`

That row is the reason this refactor exists.

The agentic ledger says the call cost nothing and `fetch failed`. Anthropic billed roughly $1.27. The socket died at 300 seconds. The meter wrote no row. **The practice cost real money, produced nothing, and the ledger reported it as free** — a CAC blind spot that gets worse exactly on the practices that take longest.

The cause is not a duration limit. It is `undici@7.28.0 lib/dispatcher/client.js:262` — `headersTimeout = 300e3`, the time allowed for the **first byte of headers**. An un-streamed agentic request runs up to 8 web searches and 8 page fetches server-side before Anthropic writes a single header. `verified` (was `inferred`).

Two fixes:

- The primary path makes no such call at all. Nothing browses; there is nothing to wait for.
- The retained escalation path now **streams**, so headers land immediately and that ceiling cannot fire. What remains is `bodyTimeout` (`:261`, also `300e3`) — the gap *between* chunks, which Anthropic's periodic `ping` events reset.

A dying stream now writes a **priced** `cost_events` row from tokens accumulated out of `message_start` (input) and `message_delta` (output). A stream that dies before any event writes an *unpriced* row naming the fault. `err.cause.code` is captured, so `UND_ERR_HEADERS_TIMEOUT` reaches the ledger instead of Node's generic `TypeError: fetch failed`.

---

## Escalation

The old agentic mechanism survives as a rare fallback for a site we cannot read.

**It fires on a bad result, never on a throw.** A thin scrape, an unparseable body, or zero verified facts escalate. A 429 does not — a transient error is unbilled and says nothing about the practice, and answering it with a $1.27 call buys an identical answer. And escalating genuinely *changes* something: Sonnet 5 browsing the web, not Haiku re-reading text that already failed.

**Triggering is free; firing is not.** `escalationTrigger` is a deterministic observation. `escalated` means $1.27 left the account. They are separate fields, and the client and its spend budget travel together in one struct — wiring the fallback without a cap is not something you can forget, it is something you cannot express.

Measured on the live cohort with the budget set to **zero**: escalation would have fired **0 / 5** times. `verified (n=5)`. Confirming that cost nothing. Wiring the default cap of 3 would have authorized $3.81 on a run that spent $0.054.

**Its facts are not provable at all, and we say so.** The agentic path `web_fetch`es the live page. We hold, at best, `cleanHtml`'s copy — which deletes `nav`/`header`/`footer`, drops every paragraph under 20 characters, emits all headings *before* all prose, dedupes, and truncates at 8k. **Our copy cannot adjudicate a snippet taken from the real page.** Checking it against ours would drop true facts as fabrication, on the one path that costs $1.27, and poison `enrich.citation_drops` — the prompt-drift alarm — with false positives.

So we verify against nothing. Every escalated fact is `url-not-held`, kept, **counted** (`factsUnverifiable`), and logged. That is the pre-refactor assurance level, which is exactly what a rare fallback should cost.

Making them provable means holding a substrate the agentic model actually read — raw per-URL page text, unpruned, alongside the cleaned text we send to the prompt. That is a real improvement and it is not built.

---

## Limits of the citation check

What the check does **not** prove, stated plainly, because the claims above are only worth what this section is worth.

**A label field's wording is never verified.** `specialty`, `website`, `linkedinUrl` and `buyingMomentContext` carry a value the model wrote *about* the snippet. Containment cannot be required of them — `"Orthopedics"` is not a substring of `"…orthopedic practice."` — so the citation is proven and the wording is not. `buyingMomentContext` is the one that can still mislead: `{value: "Opening a fourth location in Q3", snippet: "We are opening a fourth location."}` verifies, because a summary is what the field *is*. They are reported in `VerificationResult.paraphrased`, and the brief renders them as plain text, never inside quotation marks (`src/brief/schema.ts` makes the dangerous rendering unrepresentable rather than merely discouraged).

**So the headline claim is scoped:** a fabricated *quotation-field* value cannot reach the database. A label field's *phrasing* is the model's, always was, and is marked as such.

**A true span can still carry a wrong meaning.** `{value: "2004", snippet: "Suite 2004, 100 Biscayne Blvd."}` passes every gate: `2004` really is a whole word on that page. A citation check proves provenance, not semantics. Nothing here fixes that, and no amount of string matching will.

**`value ⊂ snippet` is a word match, not a substring match — and it took a review to get that right.** `snippet.includes(value)` verified `role: "COO"` against the real Schlessinger team page, because `coo` sits inside `coordinators`. EHR vendor names are the worst case in the language: `Epic` ⊂ `Epicare`, `Athena` ⊂ `AthenaHealth`, `EMA` ⊂ `ModMedEMA`. The match must now land on word boundaries. Measured over every quotation fact in all fixtures plus the captured page: **15/15 true facts survive, 0 false drops.**

**The prompt and the verifier are one contract, and they can drift apart silently.** An earlier draft of prompt rule 8 handed the model a role *vocabulary* ("practice manager … OWNER-PHYSICIAN") while rule 5 demanded `role` appear verbatim in its snippet. The real Schlessinger page prints no role noun anywhere, so the model returned `role: "Owner-Physician"`, the verifier dropped it as a fabrication, the dropped role collapsed the entire contact — and the drift alarm blamed the model for obeying its instructions. `tests/enrich/extract.test.ts` now pins the two together. **A verifier stricter than its prompt does not catch lies; it deletes truths.**

**The escalation path is not value-checked at all.** It holds no pages, so its facts exit at gate 1 as `unverifiable`. Value-checking them would enforce a contract Sonnet was never given — see [Escalation](#escalation).

---

## What the tightened check cost · `verified (n=5 practices, 2026-07-08)`

The value gate was measured before shipping, on the same five real practices:

| | before the value gate | after |
|---|---|---|
| facts verified | 17 | **18** |
| facts dropped | 1 | 1 |
| `value-not-in-snippet` drops | — | **0** |
| decision-maker named | 2 / 5 | **2 / 5** |
| pages held | 6·7·5·5·3 | **6·7·5·5·3** (identical) |
| mean cost / practice | $0.0088 | $0.0094 |

**Zero false drops.** The one drop in both runs is the same stochastic `firmographics.website` `snippet-not-verbatim` — a label field, untouched by the new gate.

**Decision-maker recall did not regress**, which was the live risk in requiring `role` to be quoted: the two practices that publish a person still yield one. The three that do not, still do not — those pages name no manager (see [Known gaps](#known-gaps)).

Honest `n`: only **4 of the 18** verified facts were quotation-class (two named contacts × `name` + `role`). No practice in this cohort publishes an EHR, so gate 3 has never fired on `ehr` against live data. The 0-false-drop result is real and it is small.

The prompt grew by exactly **521 input tokens** per practice (identical on all five — it is a fixed system prompt), which is the entire +7% cost. Buying a closed fabrication hole for six hundredths of a cent per practice is not a difficult trade.

`scripts/experiment-2-mechanism-ab.ts --out ./experiment-2b-results.jsonl` · $0.0470 spent.

---

## Known gaps

- **EHR is never found.** `n=7` (2 agentic + 5 scrape-then-extract). Practices do not publish their EHR on their website. This is a real, unsolved data gap — not a mechanism failure, and the agentic path did not solve it either.
- **Decision-maker: 2 / 5 named.** Westlake (22 locations), Virginia Women's Center (5) and WNC Ophthalmology (1) returned none. The earlier finding that a *small* practice's owner-physician is findable **does not generalize** — WNC is a one-location practice and it was not found. D9's role-only variant is the correct degradation. We have no evidence the agentic path would have done better; it never ran on those three.
- **`practice_facts.provider` cannot distinguish a verified fact from an escalation-path unverifiable one.** The `enrichment_provider` enum has two values, and adding a third is a migration this work does not own. Until then, a non-zero `factsUnverifiable` on the waterfall result is the only signal, and it is logged.

---

## Provenance

- Reference implementation: `lead-gen-optiflow` (`src/lib/scraper.ts`, `src/utils/html-cleaner.ts`, `src/utils/retry.ts`, `src/pipeline/gate3-scrape-website.ts` → `gate4-enrich-lead.ts`). Scrape-then-extract with Haiku is not a new architecture — it has run in production there for a while. What is new is what replaces its `confidence_overall` float: we hold the page, so the citation becomes a substring assertion instead of the model's opinion of its own output. That check is impossible against Optiflow's joined `combined_text`.
- Harness: `scripts/experiment-2-mechanism-ab.ts` (`--dry-run` makes zero paid calls). Results are gitignored — they carry real people's names, and this repo is public.
