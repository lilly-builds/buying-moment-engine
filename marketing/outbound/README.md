# Channel 1 — Champagne outbound

The flagship channel. It sells the product by using the product on its own market.

## The idea in one line

We find prospects the exact way Buying Moment finds leads for customers, and the
first email IS a buying-moment brief pointed at them. The outreach is the demo.

Why this is the least-effort, most-money channel for a solo founder:

- It runs on the thing you already built. No new machine to maintain.
- The email proves the value instead of claiming it, so replies are warm.
- It is fully scriptable, so day-to-day effort is: review a queue, hit send.

## How the automation works

`scripts/champagne-outbound.ts` takes a target list and builds a ready-to-send
queue. It:

1. Reads `marketing/outbound/targets.json` (or the example file if that is absent).
2. Assigns each target one of the three landing pages **round robin**, so traffic
   splits evenly across the experiments. That keeps the A/B read clean: every page
   sees the same mix of prospects, so a difference in signups is a difference in
   the page, not the audience.
3. Tags every landing link with UTM params (`utm_source=outbound`,
   `utm_medium=email`, `utm_campaign=<name>`), so a signup is attributed back to
   this channel in the readout (`npx tsx scripts/lp-report.ts`).
4. Writes two files:
   - `queue.csv` — import into any mail-merge tool or your CRM.
   - `queue.md` — read it with your own eyes before anything goes out.

It **sends nothing**. Sending is the one outward step, and it is yours.

```bash
# build the queue (uses example targets until you add your own)
npx tsx scripts/champagne-outbound.ts

# name the campaign and point at the live site
npx tsx scripts/champagne-outbound.ts --campaign=launch-w1 --base=https://buying-moment-maestro.vercel.app
```

## Go-live runbook (do this tomorrow)

1. **Build your real target list.** Copy `targets.example.json` to `targets.json`
   and replace the rows with real companies at a real buying moment. Each row needs
   the public receipt (`sourceLabel` / `sourceUrl`) that proves the moment. Start
   with 20 to 40. Good sources of "they need outbound help" moments: a new VP of
   Sales or Head of RevOps, a fresh funding round, a burst of SDR job posts.
2. **Generate the queue.** Run the script above. Read `queue.md` top to bottom.
   Cut anything that does not feel true. Truth is the whole edge here.
3. **Warm the sending inbox.** Send from a real mailbox you own (not a no-reply).
   If the domain is new, warm it for a few days first so you land in the inbox.
4. **Send in small batches.** 20 to 30 a day from one inbox. Personal, plain text,
   no images, no tracking pixels. Reply "in" is the whole funnel.
5. **Watch the readout.** `npx tsx scripts/lp-report.ts` shows signups by variant
   and by source. Outbound signups show up under `outbound`.
6. **Follow up.** Use `sequence.md` for touches 2 and 3. Most replies come on the
   follow-up, not the first email.

## Guardrails (so this stays a channel, not a complaint magnet)

- Only email a business address, with a real reason (the receipt), and an easy out.
- One inbox, small batches, real signature, real reply-to. This is 1:1 outreach,
  not a blast.
- Keep it honest: if the signal is thin, do not send. The brief's credibility is
  the product.
- Sending to real people is your call to make and your button to press. The script
  will never send for you.
