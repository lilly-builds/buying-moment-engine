# Signal Catalog

The buying-moment engine sells on the **trigger event**, not the demographic. A cold list
answers "who fits the profile?" This catalog answers a sharper question: "who is ready to buy
right now, and how do we know?" Every signal below is a public, defensible reason a healthcare
practice is hitting a buying moment for front-desk and patient-communication tooling.

This is the living map of what the engine detects today, what is built but parked, and where the
signal layer is going next. It draws a deliberate, honest line between the two, because a
documented gap is worth more than an overstated capability.

---

## How to read this

Each signal has a **kind** (the category of evidence), a **public data source**, the **buying
logic** (why it predicts a purchase), and a **status**:

| Status | Meaning |
|---|---|
| **Live** | Built, tested, and actively discovering real practices in the pipeline today |
| **Built, dark** | Code and tests ship; runs only when a paid credential or lookup list is supplied |
| **Future** | Documented and defensible; not built for this demo (a visible roadmap) |
| **Bench** | A refinement of a built signal, parked until it earns its place |
| **Research-gated** | Built only if a specific, timely rule clears the relevance bar |

---

## 1. Built: the three that ship

These three are the demo's engine. Each is a full detector: a source reader, a classifier that
scores the raw hit into a real buying signal, provenance capture (source URL plus the timestamp
it was detected, per the data-layer contract), and its own recon doc under `src/detectors/`.

| # | Signal | Kind | Public source | Why it predicts a buy | Status |
|---|--------|------|---------------|----------------------|--------|
| 1 | **Front-desk staffing spike** | Hiring | Adzuna job-posts ("patient coordinator," "front desk," "call center") | They cannot staff the phones. That is EliseAI's exact wedge. | **Live** |
| 2 | **Growth events** | Expansion | GDELT news (PE deals, acquisitions, new locations, new provider bios) | New patient volume outstrips the front desk; consolidation drives tooling standardization. | **Live** |
| 3 | **Phone-complaint reviews** | Voice-of-customer | Google Places / Maps reviews ("can't get through," "on hold forever") | Acute, self-reported phone pain, in the patient's own words. | **Built, dark** |

**The honest line on signal #3.** The Google Places review reader is fully built and tested, and
it appears as a named data source in the in-app Data Sources view. It runs **dark** in the live
pipeline because it is a *lookup*, not a *discoverer*: it needs a billed Google Places API key, a
name-to-`place_id` resolution step, and a starting list of practices to check. Signals #1 and #2
both *find* practices from scratch; #3 corroborates phone pain on practices you already have.
Lighting it up is a credential-and-lookup step, not a rewrite. Until then, the README and the
feed only claim what actually fires: staffing spikes and growth events discover the leads, and
the review reader waits behind its key.

Every detected signal carries a **freshness stamp**, because a stale trigger kills the "why now."
A **signal count** on each practice drives the feed's ranking: three signals firing outrank one,
so the AE works the hottest accounts first.

---

## 2. Research-gated: the fourth, if the moment is real

| # | Signal | Kind | Public source | Why it predicts a buy | Status |
|---|--------|------|---------------|----------------------|--------|
| 4 | **Regulation deadline** | Compliance | CMS / payer prior-auth and interoperability rules with dates | A dated rule forces a buying moment; EliseAI handles prior auth and insurance checks. | **Research-gated** |

Built **only if** a specific rule is timely, relevant to EliseAI's wedge, and significant enough
to move a buyer. A dated compliance deadline is one of the strongest timing signals there is (it
is exactly the pattern that worked in an insurance-regulation outbound play), but a vague or
distant rule is noise. It stays on the bench rather than manufacturing false urgency.

---

## 3. Future potentials: the visible roadmap

Documented, defensible, and **not built for this demo**. Each is a different *kind* of signal, not
a variation of the three above, so the roadmap shows real breadth without stretching the demo's
scope.

| # | Signal | Kind | Public source | Why it predicts a buy | Status |
|---|--------|------|---------------|----------------------|--------|
| 5 | **New ops leadership** | People | LinkedIn job-changes, practice announcements | A new practice manager, administrator, or COO in their first 90 days is a classic buying window. | **Future** |
| 6 | **Long "next available"** | Capacity | Booking widget / Zocdoc / Healthgrades | The next open appointment is weeks out. Direct proof the schedule is overwhelmed. | **Future** |
| 7 | **Patient-access tech gap** | Intent | BuiltWith / Wappalyzer | Just added online scheduling (in-market) or conspicuously lacks it (greenfield). | **Future** |
| 8 | **Peer adoption / FOMO** | Social proof | Competitor case studies, press | A same-specialty, same-metro practice just publicly adopted AI patient comms. | **Future** |

---

## 4. Bench: refinements held in reserve

Each sharpens a signal that already ships. Parked until the built three prove out and the data
says the refinement earns its keep.

| # | Signal | Refines | Public source | The added edge |
|---|--------|---------|---------------|----------------|
| 9 | **Job-post text mining** | #1 Staffing | Job-post body text | The pain named in the listing itself ("reduce no-shows," "high call volume"). |
| 10 | **Staff reviews** | #5 People | Glassdoor / Indeed employee reviews | Internal corroboration: "understaffed," "phones never stop." |
| 11 | **New service line** | #2 Growth | Practice site / announcements | New appointment complexity (a derm group adds a MedSpa). |
| 12 | **AE-submitted signal** | Extensibility | Your own reps | A rep hears a new buying-moment cue on a live call and captures it. (See the roadmap below.) |

---

## Roadmap: where the signal layer is going

*Everything below is **vision, not shipped.** It is what the catalog becomes, framed honestly so
the direction is clear without overstating the build. Today's signals are hardcoded detectors;
these two pillars are how the engine stops being static and starts compounding.*

### Pillar 1: user-adaptive signal configuration

Today, the signals are **hardcoded detectors** authored by the builder. The next step hands that
control to the user: a RevOps owner or admin who can **configure and tune their own buying
signals** from the app, with no code change.

Two things that unlocks:

- **The catalog stays current with the market.** Buying moments shift. A regulation lands, a
  competitor moves, a new pain surfaces on calls. When a user can add or reweight a signal
  themselves, the catalog tracks the market instead of going stale between releases.
- **One engine, many offerings.** A single fixed ICP is a ceiling. When each org (or each product
  line inside one org) weights, adds, and adjusts its own signals, the same engine serves a
  different pitch per offering. Signal weighting becomes a product surface, not a constant in the
  source.

This is signal #12 ("AE-submitted signal") grown from a manual input box into a full configuration
layer: v1 is a rep dropping in one insight; the destination is every org shaping its own
buying-signal model.

### Pillar 2: a sales-call learning feedback loop

The single most valuable dataset for a timing engine is what real sales calls reveal about timing.
The roadmap **closes the loop with sales-call data**:

- **Learn from the calls.** Pull call recordings and transcripts (Gong, Attention) and mine them
  for the timing truth a public source never sees: which signals *actually* preceded a deal, and
  what a rep heard on the call that marked the account "ready now."
- **Feed it back into the engine.** Route those learnings into two places at once: **signal
  scoring** (re-rank and re-weight the signals that genuinely convert) and **prospect discovery**
  (aim the finder at the buying moments that pay off). The engine gets sharper at surfacing strong
  prospects over time instead of staying static.

The guiding thesis: *the more real sales-call data feeds the strategy, the more effective the
system becomes.* Paired with Pillar 1, the loop is complete: users shape the signals, and the
calls teach the engine which of those signals are worth trusting.

---

*Source of record for the built detectors: `src/detectors/` (each signal has a `.recon.md`
documenting its source, method, and limits). The in-app Data Sources view (`/signals`) shows the
three built sources to the AE (staffing and growth discover live; the review reader waits behind
its key). Signal decisions trace to the spec's Signal Catalog (D3, D4) and
Ideas note.*
