/**
 * Worked example leads for the free finder tool. These are the credibility
 * payload: the instant, no-signup reveal shows one of these so a visitor sees
 * exactly what a researched brief looks like before they hand over an email.
 *
 * They are illustrative EXAMPLES (labelled as such in the UI), not live claims
 * about a real company right now. The real, tailored 5-pack is what gets built
 * and delivered after signup. Keeping the examples honest here is the whole
 * point: the briefs earn trust because they are specific and cited, not because
 * they pretend to be a live scan of the visitor's exact input.
 *
 * Each lead carries the three public signals that, stacked, mean "in-market now"
 * — the stacking is the product's edge, so it is what we show.
 */

export interface Signal {
  label: string;
  detail: string;
  source: string;
  when: string;
}

export interface ExampleLead {
  company: string;
  meta: string;
  headline: string; // the one-line buying moment
  signals: [Signal, Signal, Signal];
  whyNow: string;
  contact: { name: string; title: string };
  email: { subject: string; preview: string };
}

export const EXAMPLE_LEADS: ExampleLead[] = [
  {
    company: "Northwind Logistics",
    meta: "Series B · 180 staff · freight software · Chicago",
    headline: "About to rip out and replace their routing platform.",
    signals: [
      { label: "Vendor sunset", detail: "Their TMS vendor announced end-of-life for its API.", source: "acme.com/eol", when: "12 days ago" },
      { label: "Migration hiring", detail: "Posted two roles titled “TMS migration engineer.”", source: "LinkedIn Jobs", when: "this week" },
      { label: "Shopping in public", detail: "VP of Ops asked peers for “modern TMS recommendations.”", source: "LinkedIn post", when: "4 days ago" },
    ],
    whyNow: "Three independent signals in twelve days: a tool dying, a team hired to move off it, and the decision-maker shopping out loud. This is not a maybe. They are choosing a replacement right now.",
    contact: { name: "Dana Whitfield", title: "VP of Operations" },
    email: { subject: "Acme's sunset + your two migration hires", preview: "Saw Acme is sunsetting its API at the end of March, and that you're already hiring two engineers for the move. That's a rough clock to be on..." },
  },
  {
    company: "Ridgeline HR",
    meta: "Seed · 40 staff · HR software · Denver",
    headline: "A brand-new RevOps leader is rebuilding the stack.",
    signals: [
      { label: "New decision-maker", detail: "Hired their first Head of Revenue Operations.", source: "LinkedIn", when: "6 days ago" },
      { label: "Role confirmed", detail: "“Revenue Operations” appeared on the team page.", source: "ridgeline.com/team", when: "3 days ago" },
      { label: "Budget freed", detail: "Closed a seed round two months prior.", source: "press release", when: "recent" },
    ],
    whyNow: "A new RevOps leader spends their first 90 days deciding what stays and what goes, and they just closed a round to pay for it. The window is open now and closes the moment they pick their tools.",
    contact: { name: "Priya Nair", title: "Head of Revenue Operations" },
    email: { subject: "Congrats on the new role, one thing for your first 90 days", preview: "Congrats on the RevOps seat at Ridgeline. The first few months are usually when you decide what to keep and what to replace..." },
  },
  {
    company: "Cardinal Pay",
    meta: "Series A · 90 staff · fintech · Austin",
    headline: "Scaling GTM fast after a fresh raise.",
    signals: [
      { label: "Funding", detail: "Announced a $22M Series A.", source: "TechCrunch", when: "9 days ago" },
      { label: "Hiring surge", detail: "Opened 6 sales and RevOps roles at once.", source: "careers page", when: "this week" },
      { label: "New exec", detail: "Named a first VP of Sales.", source: "LinkedIn", when: "recent" },
    ],
    whyNow: "New money, a new sales leader, and a hiring spree in the same fortnight. A company building a go-to-market engine from scratch is buying the tools to run it, this quarter.",
    contact: { name: "Marcus Lee", title: "VP of Sales" },
    email: { subject: "Congrats on the raise, quick note as you build out GTM", preview: "Saw the Series A, congrats. Standing up a sales motion from scratch is the moment the right tooling either compounds or costs you..." },
  },
];

/** Deterministic pick so the same input reliably surfaces the same example. */
export function pickExample(seed: string): ExampleLead {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return EXAMPLE_LEADS[h % EXAMPLE_LEADS.length];
}
