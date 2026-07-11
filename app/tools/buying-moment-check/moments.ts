/**
 * The universal buying-moment templates behind the free playbook tool. These are
 * the REAL categories of public signal the engine watches for — not a fake scan.
 * The tool personalizes each one with what the visitor sells, so the output is an
 * honest, useful playbook ("here are the moments worth watching for your thing"),
 * which is what earns the signup. No LLM call, no backend, no cost, no PII.
 */

export interface MomentTemplate {
  title: string;
  /** How to phrase why-now. `{sell}` is replaced with what the visitor sells. */
  why: (sell: string) => string;
  where: string;
}

export const MOMENT_TEMPLATES: MomentTemplate[] = [
  {
    title: "A new decision-maker lands",
    why: (sell) =>
      `A new VP, Head, or Director in the buying seat rebuilds their stack in the first 90 days. That is a wide-open window for ${sell}.`,
    where: "LinkedIn role changes, team-page edits, press releases",
  },
  {
    title: "They outgrow their current tool",
    why: (sell) =>
      `A company scaling past what its current tool handles starts quietly shopping. That is the moment ${sell} gets a real look.`,
    where: "Job posts naming the tool, migrating-off posts, review-site activity",
  },
  {
    title: "A tool they rely on is going away",
    why: (sell) =>
      `A vendor sunset or a surprise price hike forces a switch on a deadline. Whoever shows up first with ${sell} wins.`,
    where: "Vendor end-of-life notices, pricing-change news, migration job posts",
  },
  {
    title: "They just got money",
    why: (sell) =>
      `A funding round or new credit line means budget and a mandate to grow. New money looks for ${sell} to spend it well.`,
    where: "Funding announcements, SEC filings, local business press",
  },
  {
    title: "They are growing fast",
    why: (sell) =>
      `New locations, a hiring burst, a new market. Growth creates the pain ${sell} solves before they have gone looking for a fix.`,
    where: "Job-post spikes, permits, expansion announcements",
  },
  {
    title: "They just got hit",
    why: (sell) =>
      `A complaint spike, an outage, or a breach. Fresh pain is the moment a company will finally act, and ${sell} is the relief.`,
    where: "Review spikes, status pages, breach disclosures",
  },
];

/** A light, honest cleanup of free-text so it slots into a sentence. */
export function tidy(input: string, fallback: string): string {
  const t = input.trim().replace(/\s+/g, " ");
  if (!t) return fallback;
  return t.length > 80 ? `${t.slice(0, 80)}...` : t;
}
