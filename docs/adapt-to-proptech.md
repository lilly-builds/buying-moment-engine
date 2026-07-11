# Adapting the engine to proptech (or any new vertical)

**The short version:** this repo is a healthcare buying-moment engine, but almost none of it is
*about* healthcare. The engine finds practices at a buying moment, enriches them, writes a cited
brief, ranks them into a feed, and scores its own ROI. Swap five small things and the exact same
machine works for property management, multifamily leasing, or any market where timing drives the
purchase. This guide shows the seam.

It is written for a specific reason. Housing is the proven engine (an AI leasing assistant across
a large share of the U.S. apartment market); healthcare is the newer frontier. An engine that
generalizes *back* to the home turf, and forward to the next vertical after that, is worth more
than one welded to a single ICP. This is the plan for that, not a second built product.

---

## The line: what stays, what you swap

Everything that is hard to build is vertical-agnostic. Everything you change is content you
author, not code you rewrite.

### Stays identical (the engine)

- **The detectors' mechanism.** A staffing-spike reader, a review reader, and a growth-news
  reader do not care whether the employer is a dermatology group or a property-management company.
  The source query and the classifier keywords change; the detection loop, scoring, freshness, and
  provenance capture do not.
- **The brief frame and the citation contract.** Two-tier brief (at-a-glance plus call prep),
  every fact underline-linked to its source. The structure is the trust mechanism, and it is the
  same in any vertical.
- **The enrichment waterfall.** Claude reads the real website and finds the buying-moment signals;
  the enrichment API fills the verified contact gaps. Vertical-neutral.
- **The data layer.** Normalized Postgres, provenance on every fact, idempotent ingestion,
  first-class tags. It stores a "prospect," not a "practice."
- **The ranked feed and the ROI scoreboard.** Rank by signal count; measure meetings, cost per
  meeting, conversion, and CAC with honest measured-versus-modeled tags. Identical.
- **The send handoff and CRM push.** OAuth CRM connect, tag, track, and the gated send handoff to
  the RevOps owner. Identical.

### You swap (the vertical content)

| What you change | Healthcare today | Proptech example |
|---|---|---|
| **The ICP** | Healthcare practices in four specialties | Property-management companies, multifamily operators, leasing teams |
| **The signals** | Front-desk staffing, phone-complaint reviews, growth events | Leasing-team hiring, resident-review complaints, portfolio expansion (see below) |
| **The vertical pack** | Pain line, opener, proof point, EHR-as-signal, ROI benchmark | The same five variables, authored for property management |
| **The proof points** | EliseAI clinic case studies | EliseAI housing case studies (the proven engine) |
| **The CRM tags** | `vertical`, `signal-source` | Same columns, proptech values |

---

## Proptech signal set (the swap, made concrete)

Each healthcare signal has a clean proptech twin. Same kind of evidence, same buying logic, a
different source query.

| Healthcare signal | Proptech twin | Public source | Why it predicts a buy |
|---|---|---|---|
| Front-desk staffing spike | **Leasing / resident-services hiring spike** | Job-posts ("leasing agent," "resident services," "call center") | They cannot staff the leasing office or the resident phone line. EliseAI's leasing-AI wedge. |
| Phone-complaint reviews | **Resident-review complaints** | Apartments.com / Google / Yelp reviews ("no one answers," "waited days for maintenance") | Acute, self-reported response-time pain from residents and prospects. |
| Growth events | **Portfolio expansion** | News and filings (acquisitions, new lease-ups, new developments, PE deals) | New units outstrip the leasing team; consolidation drives tooling standardization. |

Proptech-native additions worth building next: **high-vacancy / slow-lease-up signals** (units
sitting empty is direct proof the leasing funnel is leaking), and **new property-management software
gaps** (a portfolio that just switched or conspicuously lacks an online-leasing stack).

---

## A worked vertical pack (property management)

The pack is one authored set of five variables. Here is the proptech version, to show the shape:

- **Pain + fit line.** "Multifamily operators your size lose prospects to unanswered leasing calls
  and slow maintenance response, especially during peak lease-up. The front line cannot keep up."
- **Opener language and tone.** Leads with the leasing-funnel leak, not the technology.
- **Proof point.** One real, citable EliseAI housing case study (the proven engine has the
  strongest proof of any vertical here).
- **Stack-as-signal.** Which property-management software (Yardi, RealPage, Entrata) flags the ICP,
  the way an EHR flags a clinic specialty.
- **ROI benchmark.** Leasing-call volume, tour-to-lease conversion, and average unit value feeding
  the ROI number.

Everything else in the brief and the engine stays exactly as built.

---

## The steps to adapt

1. **Author the vertical pack(s)** under `src/packs/` (copy an existing pack; fill the five
   variables for the new vertical). Use the `proof_pending` sentinel honestly if a citable case
   study does not exist yet, rather than inventing one.
2. **Point the detectors at the new sources.** Update the source queries and classifier keywords in
   `src/detectors/` (job titles, review venues, news queries). The detection loop is untouched.
3. **Retune the ICP resolver** so discovery targets the new prospect type instead of clinics.
4. **Relabel the tags** (`vertical`, `signal-source`) with the new vertical's values. First-class
   columns, so every scoreboard slice works immediately.
5. **Swap the proof points and ROI benchmarks** to the new vertical's real numbers.
6. **Leave the rest alone.** Feed, brief frame, citation contract, enrichment waterfall, data
   layer, scoreboard, send handoff, and CRM push carry over with no change.

The measure of a good engine is how little of it you touch to enter a new market. Here it is five
content swaps and a source-query retune. That is the point.

---

*Origin: the spec's Ideas note ("here's a guide on how to adapt this repo to a proptech product").
This is a generalization plan, not shipped code for a second vertical.*
