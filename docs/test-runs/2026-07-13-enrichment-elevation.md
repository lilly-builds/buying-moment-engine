# Enrichment elevation: choosing a coverage-first waterfall

Date: 2026-07-13

This is the test record behind the enrichment architecture the engine now uses. The goal was to raise lead enrichment completeness (decision-maker name, LinkedIn, and a usable email or contact path) toward a 95% target. We tested real providers on real leads and let the numbers pick the design.

Two principles held throughout:

- A real contact is better than no contact, but every contact is labeled by quality. We never guess email patterns.
- If a planned test step fails (auth, credits, rate limit), stop and report it blocked. Do not quietly swap in a different provider and present it as the intended test.

## The starting point

A live query of the database on the test date:

- 53 real practices, 24 with a website URL
- 10 with any contact row, 9 with a named contact, 6 with a LinkedIn, 1 with a stored email
- 44 with no named contact yet

So the gap was not mainly email verification. It was finding the right person at each practice.

## What we tested

### Email providers, on 9 named contacts with no email

| Provider | Names | Emails returned | Counted work emails | LinkedIn |
|---|---:|---:|---:|---:|
| BetterContact | 9/9 | 7/9 | 7/9 | 5/9 |
| FullEnrich | 9/9 | 9/9 | 5/9 | 5/9 |
| Prospeo | 4/9 | 4/9 | 4/9 | 4/9 |

Counted as a work email: BetterContact `deliverable` / `valid` / `catch_all_safe`, FullEnrich `DELIVERABLE`, Prospeo `VERIFIED`. Personal emails were recorded but not counted as work emails. (A normalizer bug initially undercounted BetterContact; the corrected number is 7/9.)

### Strict FullEnrich-first, BetterContact fallback, on 22 leads

The intended email waterfall, scored against the 95% bar (at least 21 of 22 complete with name plus LinkedIn plus email):

- Complete: 13/22 (59%). Target not met.
- People resolved: 17/22. LinkedIn: 17/22. Safe work emails: 13/22. No email: 9/22.

| Step | Result |
|---|---:|
| FullEnrich emails returned | 11 |
| FullEnrich safe/deliverable | 5 |
| FullEnrich weak/high-probability | 6 |
| BetterContact fallback calls | 12 |
| BetterContact safe emails | 8 |
| Combined safe emails | 13 |

Credits: FullEnrich 10, BetterContact 8. FullEnrich `HIGH_PROBABILITY` results were often upgraded to safe by BetterContact. But the combined result barely beat the earlier BetterContact-only run (13 versus 12 safe emails), because the real bottleneck was person discovery, not email verification.

### HTML scrape, on the same 22 leads

The free, already-built website scraper and its published-org-email fallback:

- 15 had a website, 14 scraped cleanly, 4 had any published email, 2 yielded an org-inbox fallback.
- It added zero new contactability on leads the vendors had already missed.

The read: scrape first because it is free and gives website validation, staff clues, and an org-email fallback, but it does not close the 95% gap on its own.

### Person search, provider vs provider

Because the real gap was person discovery, we ran a person-search-only bakeoff with no email spend.

First pass, 10 leads, searching mostly by company and domain:

| Provider | Name | LinkedIn | Buyer-fit title |
|---|---:|---:|---:|
| FullEnrich | 10/10 | 10/10 | 8/10 |
| Prospeo | 10/10 | 10/10 | 10/10 |
| PDL | 0/10 | 0/10 | 0/10 |

PDL returned nothing because its query used an exact job-title match, which misses title variants. That is a wiring limitation, not proof PDL lacks the data. On a few rows the providers disagreed on who the right person was (for example, one picked a junior coordinator while another picked a practice manager), a reminder that "found a person" and "found the right person" are different bars.

The lesson: the first pass under-used provider-side filtering. All four search endpoints support title and seniority filters, and we had mostly searched by company alone.

Second pass, filtered for owners, operators, practice managers, and admins:

- Prospeo: 15/17 people found
- PDL: 14/17 (then blocked by its search allowance)
- FullEnrich: 13/17

Prospeo had the best coverage when asked for the right roles, and coverage is what the 95% goal rewards at this stage.

## The person-ranking rubric

A found person is scored into a tier, and the best buyer is kept separate from the best reachable fallback:

- Tier A, owner/operator: founder, owner, managing partner, CEO, COO, president, physician owner
- Tier B, practice operations: practice administrator, practice manager, operations manager, director of operations, clinic manager
- Tier C, admin/revenue: office manager, revenue cycle manager, billing manager, administrator
- Tier D, reachable fallback: coordinator, executive assistant, patient access manager, scheduling manager
- Tier E, clinician only unless there is an owner/operator signal: physician, doctor, MD, therapist

Sales, marketing, students, interns, recruiters, and unrelated corporate roles are deprioritized or excluded.

## The decision: a coverage-first waterfall

The evidence pointed to one conclusion. Optimize for coverage first, because the bottleneck is finding a real, usable contact, not verifying an email once you have one. PDL is left out of this pass to keep the architecture simpler and avoid its search-allowance and rate-limit complexity.

The order:

1. Scrape the website first (free): homepage plus about, team, providers, leadership, and contact pages. Capture the published org-email fallback and the practice's LinkedIn and Facebook.
2. Prospeo person search first, with provider-side role filters (owners, operators, managers, admins).
3. FullEnrich person search as the fallback, only when Prospeo misses or returns a weak or unrelated role.
4. Rank the candidates. Keep best buyer and reachable fallback separate. Prefer coverage, but label role quality.
5. Normalize social URLs, keeping person LinkedIn separate from company LinkedIn and Facebook.
6. Email waterfall on the selected person: FullEnrich first, then BetterContact to fill or upgrade a missing, weak, or unsafe result. FullEnrich `HIGH_PROBABILITY` counts as weak until upgraded.
7. If there is no person email, use the scraped org inbox. If there is no email at all, keep the company LinkedIn or Facebook as fallback contactability.
8. Record a failure reason per step: no website, scrape failed, no person, weak role only, no LinkedIn, no email, or provider blocked.

Email quality is labeled on a fixed scale: verified/deliverable work, safe/catch-all work, high-probability work, unverified work, personal, org inbox, none.

## Next step

Wire this coverage-first waterfall into the production enrichment path, then run a full replay across the real lead set and score it against the 95% target, reporting person, LinkedIn, social, and email or contactability completeness with a reason for every incomplete lead.
