/**
 * Champagne outbound builder — the "drink your own champagne" GTM channel.
 *
 * The pitch: we find prospects the exact way the product finds leads for
 * customers, and the outreach email IS a buying-moment brief pointed at them.
 * That makes the first touch a live demo instead of a cold ask.
 *
 * What this script does (and does NOT do):
 *   - reads a target list (marketing/outbound/targets.json, or the example file)
 *   - assigns each target one of the three landing pages ROUND ROBIN, so traffic
 *     splits evenly across the experiments and the A/B read stays clean
 *   - tags each landing link with UTM params so signups attribute to this channel
 *   - renders a personalized first-touch email per target
 *   - writes a REVIEW QUEUE (marketing/outbound/queue.csv + queue.md)
 *   - it SENDS NOTHING. Sending is an outward action a human owns. The queue is
 *     what you review and send from once your inbox is connected. See README.md.
 *
 *   npx tsx scripts/champagne-outbound.ts
 *   npx tsx scripts/champagne-outbound.ts --campaign=launch-w1 --base=https://buying-moment-maestro.vercel.app
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const VARIANTS = ["saas", "outbound", "founders"] as const;
type Variant = (typeof VARIANTS)[number];

const DIR = join(process.cwd(), "marketing", "outbound");
const DEFAULT_BASE = "https://buying-moment-maestro.vercel.app";
const SENDER = "Lilly";

interface Target {
  company: string;
  firstName: string;
  title: string;
  email: string;
  signalLabel: string;
  signalPlain: string;
  sourceLabel: string;
  sourceUrl: string;
}

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
}

function loadTargets(): Target[] {
  const real = join(DIR, "targets.json");
  const example = join(DIR, "targets.example.json");
  const path = existsSync(real) ? real : example;
  const usingExample = path === example;
  if (usingExample) {
    console.log("Using targets.example.json (fictional companies). Drop a real targets.json here to run for real.\n");
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as { targets: Target[] };
  return raw.targets;
}

function landingUrl(base: string, variant: Variant, campaign: string): string {
  const q = new URLSearchParams({
    utm_source: "outbound",
    utm_medium: "email",
    utm_campaign: campaign,
  });
  return `${base}/for/${variant}?${q.toString()}`;
}

function firstTouch(t: Target, url: string): { subject: string; body: string } {
  const subject = `${t.firstName}, a note on ${t.company}`;
  const body = [
    `Hi ${t.firstName},`,
    ``,
    `Saw ${t.signalPlain}. That is usually right when a team leans harder on outbound.`,
    ``,
    `Quick, meta pitch: I found you the same way our product finds leads for our customers. Buying Moment watches the public web for companies hitting a moment like yours, then hands the rep a one-screen brief: who to contact, why now (with the public source), and a first email. This note is one of those briefs, pointed at you.`,
    ``,
    `Here is what your reps would get every morning: ${url}`,
    ``,
    `Want your first 3 briefs free? No card, no setup. Reply "in" or grab them here: ${url}`,
    ``,
    `— ${SENDER}, Buying Moment`,
  ].join("\n");
  return { subject, body };
}

function csvCell(s: string): string {
  // Quote and escape for CSV. Newlines are allowed inside a quoted cell.
  return `"${s.replace(/"/g, '""')}"`;
}

function main() {
  const base = arg("base", DEFAULT_BASE).replace(/\/$/, "");
  const campaign = arg("campaign", "launch-w1");
  const targets = loadTargets();

  const rows = targets.map((t, i) => {
    const variant = VARIANTS[i % VARIANTS.length];
    const url = landingUrl(base, variant, campaign);
    const { subject, body } = firstTouch(t, url);
    return { t, variant, url, subject, body };
  });

  // even-split summary
  const split: Record<Variant, number> = { saas: 0, outbound: 0, founders: 0 };
  for (const r of rows) split[r.variant]++;

  // CSV (import into any mail-merge or your CRM)
  const header = ["company", "firstName", "title", "email", "variant", "landingUrl", "subject", "body"];
  const csv = [
    header.join(","),
    ...rows.map((r) =>
      [r.t.company, r.t.firstName, r.t.title, r.t.email, r.variant, r.url, r.subject, r.body].map(csvCell).join(","),
    ),
  ].join("\n");
  writeFileSync(join(DIR, "queue.csv"), csv + "\n");

  // Human-readable review queue
  const md = [
    `# Outbound review queue — campaign: ${campaign}`,
    ``,
    `Generated from ${targets.length} targets. Landing split (even by design): saas ${split.saas} · outbound ${split.outbound} · founders ${split.founders}.`,
    ``,
    `> Nothing here has been sent. Review each, then send from your connected inbox (see README.md).`,
    ``,
    ...rows.flatMap((r) => [
      `---`,
      ``,
      `## ${r.t.company} — ${r.t.firstName} (${r.t.title})`,
      `- to: ${r.t.email}`,
      `- landing: ${r.variant} → ${r.url}`,
      `- receipt: ${r.t.sourceLabel} (${r.t.sourceUrl})`,
      ``,
      `**Subject:** ${r.subject}`,
      ``,
      "```",
      r.body,
      "```",
      ``,
    ]),
  ].join("\n");
  writeFileSync(join(DIR, "queue.md"), md);

  console.log(`Built ${rows.length} first-touch emails.`);
  console.log(`Even landing split -> saas: ${split.saas} | outbound: ${split.outbound} | founders: ${split.founders}`);
  console.log(`Base URL: ${base}`);
  console.log(`\nWrote:`);
  console.log(`  marketing/outbound/queue.csv  (mail-merge / CRM import)`);
  console.log(`  marketing/outbound/queue.md   (human review)`);
  console.log(`\nSent: 0. Review the queue, then send from your inbox. See marketing/outbound/README.md.`);
}

main();
