# Overnight build — GTM landing experiments + two marketing channels

Built 2026-07-11, overnight. Branch: `marketing-landing-experiments`.
Bottom line: three A/B landing pages, real end-to-end signup capture, a readout
you run with one command, and two marketing channels, all wired and verified.
Nothing was pushed to your live production domain and no outreach was sent. Both
of those are one command away, and they are yours to press.

---

## 1. What you can look at right now

Four tabs are already open in Chrome (served from a local production build):

- http://localhost:3020/for/saas
- http://localhost:3020/for/outbound
- http://localhost:3020/for/founders
- http://localhost:3020/tools/buying-moment-check  (the free tool)

These are the REAL production build with your real database keys, so the signup
form actually works: a submit writes a lead to the `waitlist_signups` table.

There is also a Vercel-hosted preview, but it is gated behind Vercel login (your
account) and its forms are inert there because preview deployments do not carry
the database keys. Treat the local tabs as the real thing to click through.

Preview URL (log into Vercel to view): see the end of this doc.

---

## 2. The three pages, and what each one tests

One product ("Buying Moment"), one page template, three deliberate bets. Each
page moves four levers together (niche, positioning, packaging, price), so the
test tells you which whole angle wins, not which comma.

| Page | Who it targets | The angle | Packaging | Price |
|---|---|---|---|---|
| `/for/saas` | B2B software revenue teams | Signal-led: catch the switch, the sunset, the new exec | Seats + briefs | $199 / $499 / $999 |
| `/for/outbound` | Anyone who sells B2B | Outcome-led, plain: reach them the moment they need you | Simple brief bundles | Free / $99 / $299 |
| `/for/founders` | Founders + lean teams | The AI wedge: it learns your buyer from your sales calls | Your AI researcher | Free / $79 / $199 |

Why this split: your open question was the buyer/niche. `/for/saas` is the
up-market techy niche you were curious about; `/for/outbound` is the broadest,
easiest-to-explain framing; `/for/founders` leads with the onboarding-agent moat
at the lowest price. Run traffic and let signups pick.

All three share the cited-brief showcase (the "this is one brief" section) because
that finished-brief-plus-ready-email is the actual product edge, whichever niche
wins.

---

## 3. What is wired end-to-end (verified, not assumed)

- **Signup capture.** The "get my 3 free briefs" form posts to `/api/waitlist`
  (public, validated, honeypot-guarded) and writes a real lead to
  `waitlist_signups`, tagged by which page and which traffic source converted it.
  Verified with real POSTs; a repeat submit of the same email is idempotent (one
  lead, not a duplicate), so the numbers stay clean.
- **View tracking.** Each page fires a one-per-visitor beacon to `/api/track`,
  so conversion RATE (signups / views) is a real query.
- **The readout.** Run this any time:
  ```
  npx tsx scripts/lp-report.ts
  ```
  It prints views, signups, and conversion rate per page, plus signups by traffic
  source. Right now it reads "no traffic yet" because the tables are clean.
- **Database.** Two new tables (`waitlist_signups`, `marketing_events`), created
  in your live Supabase, RLS-locked like everything else, marketing-only (they
  never touch product data). They are empty and ready.

---

## 4. Two marketing channels, both feeding the three pages evenly

Every link from both channels is UTM-tagged and split evenly across the three
pages, so the A/B read stays clean (same audience, different page).

### Channel 1 — Champagne outbound (the flagship)
The product sells itself: you find prospects the same way the product finds leads
for customers, and the first email IS a buying-moment brief pointed at them.

- `scripts/champagne-outbound.ts` turns a target list into a ready-to-send review
  queue (`marketing/outbound/queue.md` and `queue.csv`), round-robin across the
  three pages. It **sends nothing** on its own.
- Playbook + go-live runbook: `marketing/outbound/README.md`.
- The 3-touch sequence: `marketing/outbound/sequence.md`.
- To go live tomorrow: drop your real prospects into
  `marketing/outbound/targets.json`, run the script, read the queue, send from
  your own inbox in small batches. Sending is the one outward step, and it is
  yours to press.

### Channel 2 — Free-tool wedge (the compounding one)
Zero marginal cost, runs itself.

- **Free tool** at `/tools/buying-moment-check`: someone types what they sell and
  instantly gets a playbook of the public moments that mean a buyer is ready, plus
  a sample brief, then a CTA into one of the three pages. No signup to use it, so
  it earns trust first. Honest by design: it is a curated playbook, not a fake
  live scan.
- **Programmatic SEO** at `/moments` and `/moments/[industry]` (B2B software,
  dental, agencies, accounting, logistics to start): real field-guide content that
  can rank for "buying moments in X" and funnels to the pages. Add more industries
  by editing `app/moments/industries.ts`, no new code.

---

## 5. How to actually go live (your call, one command)

Your production site (buying-moment-maestro.vercel.app) is untouched: it still
serves only your existing product, and `/for/saas` there still 307s. When you are
happy with the pages:

```
cd ~/Developer/buying-moment-engine
vercel deploy --prod
```

Production already has the database keys and the two new tables, so the moment
you promote, the pages AND the signup forms are fully live at
buying-moment-maestro.vercel.app/for/saas (and /outbound, /founders, /tools, /moments).

The work is committed on the `marketing-landing-experiments` branch (three
commits). Nothing was pushed to `main`.

---

## 6. What I deliberately did NOT do (and why)

- **Did not push to your production domain.** Deploying public pages to your live
  site is an outward act that should be your decision. It is one command away.
- **Did not send any outreach.** The outbound queue is built and staged; sending
  to real people is yours to press, from your own warmed inbox.
- **Did not copy your production secrets into the Vercel preview environment.**
  That would weaken environment isolation. It is why the preview forms are inert.
- **Did not set up a real prospect list.** The example targets are fictional
  (`.test` emails) so nothing false about a real company was ever staged.
- **Did not buy a domain or register a brand.** "Buying Moment" is still a working
  name pending your USPTO check.

---

## 7. Honest risk notes

- **Rate limiting is basic.** The write routes have a honeypot and per-email
  dedup, which stops naive bots and double-submits. A determined script could
  still spam random emails. If traffic gets real, add an IP limiter (Vercel KV or
  Upstash) on `/api/waitlist` and `/api/track`. Blast radius is limited to the two
  marketing tables.
- **Brand name.** "Buying Moment" is descriptively weak and near Revenue.io's
  "Moments." Run the USPTO search before investing in it.
- **Migration drift (pre-existing, not from this work).** Your live database was
  one migration ahead of `origin/main` before I started, so the two marketing
  tables were applied with a controlled idempotent script
  (`scripts/apply-marketing-migration.ts`), not `drizzle-kit migrate`. The
  migrations (`0009`, `0010`) are in the repo for history.

---

## 8. Verification log (what "verified" means here)

- Typecheck: clean. Lint: clean. Full test suite: 1062 passed, 6 skipped.
- Production build: succeeded; all routes generate (3 landing pages + 5 SEO pages
  static, capture routes dynamic).
- Signup POST: returns 200 and writes a real row; second identical submit is
  idempotent (same id, no duplicate). Honeypot: fake-success, no row. Invalid
  email: 400. All test rows cleaned up; tables at 0/0 for launch.
- Fresh-eyes review (independent subagent): verdict SHIP. Its two findings
  (idempotent signups, own-property variant check) are fixed and committed.
- The three pages and the free tool were opened and visually reviewed.

Preview URL (Vercel-login gated):
https://buying-moment-maestro-860e17j16-lilly-field-co.vercel.app
