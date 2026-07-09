# ROI Scoreboard — how every number is calculated

This is the reference for the `/scoreboard` page (U12). It documents, for every number on
the screen: what it means in plain words, the exact equation, which database rows it comes
from, its honesty tag, and what happens when there's no data.

The aggregation lives in `app/scoreboard/data.ts` (`buildScoreboardData`); the raw queries
live in `db/queries.ts`. This doc is the human-readable mirror of that code — if they ever
disagree, the code is the truth and this doc is the bug.

---

## The one idea first

The scoreboard is **computed, never stored**. Every time you open it, it re-reads the events
the tool already writes (`roi_events`, `cost_events`) plus the AE `feedback` and CRM
`crm_links`, and does the arithmetic live. Nothing here is a saved number that can go stale.

Two things ride on every figure:

- **An honesty tag** — `measured` (read straight off real tool activity) or `modeled`
  (a projection). This is load-bearing: we never dress a projection up as a measurement.
- **A scope** — the toggle at the top. **All** is every practice; a specialty scope
  (Dermatology, Women's Health, …) is only the practices in that vertical.

---

## Building blocks (define these once, reuse everywhere)

**The funnel is counted _per practice_, not per event.** The tool logs `lead_pushed`,
`meeting_booked`, and `deal_won` **at most once per practice** (a practice that reaches the
meeting stage twice is still one meeting). So within a scope:

| Symbol | Name | Definition |
|---|---|---|
| **L** | Leads | number of practices with a `lead_pushed` event |
| **M** | Meetings | number of practices with a `meeting_booked` event |
| **D** | Deals | number of practices with a `deal_won` event |
| **S** | Spend | sum of `cost_events.cost_usd` — one row per metered paid API call |

**How a scope is applied.** The milestone events (`meeting_booked` / `deal_won`) don't carry
a vertical of their own, so we read each event's vertical from **the practice it belongs to**
(`roi_events → practices.vertical`). "All" includes every practice; a specialty scope keeps
only the practices in that vertical. Spend rows with no practice attached (shared infra)
count in **All** but in no single specialty.

**Rounding.** Dollars are shown to the whole dollar (`$20`, not `$20.28`). Rates are stored as
fractions from 0–1 and the UI renders them as whole percentages.

---

## The metrics

### End goals — the two lagging outcomes

**Deals won** &nbsp;·&nbsp; tag: `modeled`
> How many prospects became paying customers.

```
Deals won = D
```
Always shows a number (0 if none). Tagged `modeled` because a closed deal is a downstream
outcome the tool influences but doesn't control, and at low volume it's a projection, not a
settled fact.

**Cost to win a customer (CAC)** &nbsp;·&nbsp; tag: `modeled`
> What the tool spent, per customer won.

```
CAC = S ÷ D              (shows "—" when D = 0)
```
This is a **blended** CAC — see [The CAC deep-dive](#the-cac-deep-dive) below for why the sum
is the correct definition and not per-winning-customer. Tagged `modeled` because it's tool
spend only (not fully-loaded), and because it's noisy at low deal counts.

### Leading signs — the early numbers that move the outcomes above

**Meetings the tool booked** &nbsp;·&nbsp; tag: `measured`
```
Meetings = M
```

**Cost per meeting** &nbsp;·&nbsp; tag: `measured`
```
Cost per meeting = S ÷ M     (shows "—" when M = 0)
```

**Messages to land a meeting** &nbsp;·&nbsp; tag: `measured`
> The average length of an outreach sequence.
```
Messages = (Σ touches over all sequences in scope) ÷ (number of sequences)
                                             (shows "—" when there are no sequences)
```
Note: this is a **proxy** — it's the average number of touches in a stored sequence, not a
literal "messages sent until the booking landed." It's honestly sourced (real sequence rows)
but reads the concept loosely.

**Hours saved this month** &nbsp;·&nbsp; tag: `measured`
> The tool's own estimate of staff hours it took off the desk.
```
Hours saved = Σ (hours on each time_saved_estimate event in scope)
```

### Which signals turn into meetings?

**Overall conversion** (the ring)
```
Overall conversion = M ÷ L        (0 when L = 0)
```

**Per-signal conversion** (the three bars) — for each signal kind *k*:
```
rate(k) = (practices carrying signal k that booked a meeting)
          ÷ (practices carrying signal k that were pushed as a lead)
detail  = "{meetings} meetings / {leads} leads"
```
A practice that carried two signal kinds counts under **both** — so the per-signal lead
counts can add up to more than L. That's intentional: it answers "when this signal was
present, how often did it convert?", not "which single signal caused the meeting."

### Which specialties win fastest & cheapest? (the per-vertical table)

For each specialty (computed exactly like a scope):

**Win rate**
```
Win rate = D ÷ L      (0 when L = 0)
```
**Cost / meeting** — `S ÷ M` within the specialty ("—" when M = 0).

**Cycle** — the average sales-cycle length:
```
Cycle = average(crm_links.cycle_time_days for practices in the specialty)   ("—" if none)
```

### Did the AE mark it good? (feedback)

From the `feedback` table (one 👍/👎 per practice per AE), within scope:
```
Thumbs-up rate = up ÷ (up + down)          (0 when there are no votes)
Total rated    = up + down
Reason counts  = number of 👎 votes carrying each reason
                 (too small / wrong specialty / already a customer / bad timing)
```

### The big test — buying-moment vs cold list

Splits the funnel by the cohort tagged on the `lead_pushed` event:
```
Buying-moment = { meetings, deals } for practices with cohort = "buying_moment"
Cold list     = { meetings, deals } for practices with cohort = "cold"
```

---

## The CAC deep-dive

**CAC = total tool spend ÷ customers won.** It is a *pooled* number, and that is correct — not
a shortcut.

To win **4** customers, the tool worked **18** prospects (enriched and briefed all 18; 14 never
closed). The money spent on the 14 that didn't convert **is part of what it cost to get the 4
that did**. That is the definition of customer-acquisition cost: total money in, customers out.

A *per-winning-customer* figure — summing only a winner's own ~$6 of enrichment — would be
**misleading, not more precise**: it pretends the 14 that didn't convert were free. That's not
CAC; it's "cost to enrich one practice."

> **Heuristic:** CAC is the cost of the whole funnel divided by the wins it produced — not the
> receipt for one customer's paperwork.

Where per-customer attribution *does* help, and we already do it:

- **Per-specialty CAC** — the scope toggle runs the same `S ÷ D` over just that vertical's
  practices. Real segmentation.
- Every `cost_events` row carries its `practice_id` and `pipeline_step`, so we can later add
  "spend by pipeline step" or "spend on won vs. lost prospects" — the genuinely useful
  per-customer cuts.

---

## Honesty tags at a glance

| Metric | Tag | Why |
|---|---|---|
| Meetings, Cost/meeting, Messages, Hours saved | `measured` | Read straight off the tool's own logged activity + metered spend |
| Deals won, CAC | `modeled` | Downstream outcomes, projected/noisy until deal volume grows; CAC is tool-spend-only, not fully loaded |
| Signal conversion, Win rate, Cycle, Feedback, Big test | (untagged) | Ratios/counts shown without a badge; each is real data, degraded honestly when empty |

---

## Degradation rules (no data ≠ a fake number)

Every ratio is denominator-guarded. When the denominator is zero the metric shows **`—`**
(or `0` for a plain count), never `$Infinity`, `NaN`, or a fabricated figure:

- CAC → `—` when `D = 0`
- Cost per meeting → `—` when `M = 0`
- Messages → `—` when there are no sequences
- Cycle → `—` when no practice in the specialty has a recorded cycle time
- An empty database renders an all-zero scoreboard, not a crash.

---

## Known limitations / not-yet-wired

Honest gaps between what the labels say and what the math currently does:

1. **Time windows aren't filtered yet.** The labels say "this quarter" (deals) and "this
   month" (leading signs), but the aggregation currently counts **all** recorded events, with
   no `created_at` filter. For the seeded demo this is accurate — every seeded event is stamped
   "now" — but against real, accumulating data these numbers would need a date filter to honor
   their labels. *(Fix: filter `roi_events` / `cost_events` by `created_at` within a window
   derived from `now`. Needs a product call on the window: calendar quarter/month vs. trailing
   90/30 days.)*
2. **Period-over-period deltas are omitted.** The design has room for "+6 vs last qtr" style
   deltas; they're deliberately not shown rather than faked, because they need a prior-window
   baseline the event log doesn't yet carry.
3. **CAC is tool/API spend only** (`cost_events`), not fully-loaded acquisition cost (no rep
   salaries). It's a floor — hence the `modeled` tag.
4. **The "cold list" cohort reads 0/0 against real data** until cold-sourced leads are tagged
   with `cohort: "cold"` on their `lead_pushed` event. Only the demo seed writes that tag today;
   production `pushPracticeLead` does not. The scoreboard degrades honestly (zeros) and the UI
   flags it "Measuring now."
5. **"Messages to land a meeting" is a proxy** (average sequence length), not a literal count
   of messages sent before a booking.
