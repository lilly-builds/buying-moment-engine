# Enrichment — how a practice becomes a cited brief

`scrape → extract → verify → PDL gap-fill → persist`

Every claim on this page is labelled `verified (n=…)` or `inferred`. Nothing here is an estimate wearing a number's clothes.

---

## The method

1. **Scrape** the practice's own website (`src/enrich/scrape.ts`). Fetch `robots.txt` once per origin, then the homepage; discover same-host links with `cheerio` and bucket them by keyword — `team · about · locations · services · patients · careers · news`. Fetch the best match per bucket, in parallel, skipping any path `robots.txt` disallows. Clean each page to text (`html-clean.ts`).

   The result is a **`Map<absoluteUrl, cleanedText>`** — never a flattened blob. The URL key *is* the provenance; join the pages together and all you can prove is that a sentence exists *somewhere*.

2. **Extract** (`src/enrich/extract.ts`). One **Claude Haiku 4.5** call over the text we already hold, with structured outputs (`output_config.format`). The user message is a sequence of `=== SOURCE: <absoluteUrl> ===` blocks, so the model is physically unable to cite a page we do not have — no other URL appears in its context.

3. **Verify** (`src/enrich/citations.ts`). Every fact arrives as `{value, sourceUrl, snippet}`. We assert the snippet is a **verbatim, contiguous substring** of the page it cites, after normalizing *both sides* identically (lowercase · collapse whitespace runs · curly quotes → straight · en/em-dash → hyphen). If it isn't, the fact is **dropped**, and the drop is returned and logged — never swallowed.

4. **PDL gap-fill** (`src/enrich/pdl.ts`). Called *only* for the fields the extractor left blank *and* the stored contact cannot already fill — a practice whose staff page publishes the manager's name, email and LinkedIn makes **zero** PDL calls, and so does a re-run.

5. **Persist.** Only verified facts reach `practice_facts`, each with its own evidence row carrying `source_url`, `snippet` and `detected_at`.

An **agentic fallback** (Sonnet 5, server-side `web_search` + `web_fetch`) is retained for practices whose site we cannot read. It fires on a *bad result* — a thin scrape, an unparseable body, or zero verified facts — never on a thrown error, and it is capped by a run-wide spend budget. See [Escalation](#escalation).

---

## Why hold the page: D2 became a test

The requirement (D2 / R5) is *"the brief never states an uncited fact."*

Before this refactor, that was enforced by a schema that checked a fact **has** a `sourceUrl` and a `snippet` — never that the snippet is on that page. It *could not be*: the old mechanism let Claude browse, and we never held the bytes it read. A snippet stitched together from three separate parts of a page arrived carrying a real URL and looking exactly like a quotation.

Holding the page makes the check arithmetic. It has caught fabrication **three times**:

| when | practice | field | what happened |
|---|---|---|---|
| prompt experiment, round 1 | schlessinger-md-dermatology | `providerCount` | three names that appear on the team page as three separate `<h2>` headings, comma-joined into a sentence that appears nowhere |
| prompt experiment, round 2 | virginia-womens-center | `locationsCount` | stitched from a location list |
| **live production path** | schlessinger-md-dermatology | `firmographics.website` | `snippet-not-verbatim` |

**The third catch did not reproduce.** Re-running that one practice gave *identical* input (8,274 tokens — the scrape is deterministic) and *different* output (366 vs 352 tokens), with **zero drops**. `verified (n=2 identical calls)`.

So the fabrication is **stochastic**. Same page text, same prompt: the model stitched a snippet on one call and not the next. A defect that only appears sometimes cannot be caught by reading the output, by a model's self-reported confidence score, or by tightening the prompt. It can only be caught by holding the page.

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

---

## Cost and latency · `verified (n=5 practices, 2026-07-08)`

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

**Its facts are not fully provable, and we say so.** The agentic path browses the open web, so most of its citations name pages we never fetched. Those are kept, **counted** (`factsUnverifiable`), and logged — the pre-refactor assurance level, which is what a rare fallback should cost. It gets no exemption on pages we *do* hold: a snippet that is not on one of those is dropped, whichever model produced it.

---

## Known gaps

- **EHR is never found.** `n=7` (2 agentic + 5 scrape-then-extract). Practices do not publish their EHR on their website. This is a real, unsolved data gap — not a mechanism failure, and the agentic path did not solve it either.
- **Decision-maker: 2 / 5 named.** Westlake (22 locations), Virginia Women's Center (5) and WNC Ophthalmology (1) returned none. The earlier finding that a *small* practice's owner-physician is findable **does not generalize** — WNC is a one-location practice and it was not found. D9's role-only variant is the correct degradation. We have no evidence the agentic path would have done better; it never ran on those three.
- **`practice_facts.provider` cannot distinguish a verified fact from an escalation-path unverifiable one.** The `enrichment_provider` enum has two values, and adding a third is a migration this work does not own. Until then, a non-zero `factsUnverifiable` on the waterfall result is the only signal, and it is logged.

---

## Provenance

- Reference implementation: `lead-gen-optiflow` (`src/lib/scraper.ts`, `src/utils/html-cleaner.ts`, `src/utils/retry.ts`, `src/pipeline/gate3-scrape-website.ts` → `gate4-enrich-lead.ts`). Scrape-then-extract with Haiku is not a new architecture — it has run in production there for a while. What is new is what replaces its `confidence_overall` float: we hold the page, so the citation becomes a substring assertion instead of the model's opinion of its own output. That check is impossible against Optiflow's joined `combined_text`.
- Harness: `scripts/experiment-2-mechanism-ab.ts` (`--dry-run` makes zero paid calls). Results are gitignored — they carry real people's names, and this repo is public.
