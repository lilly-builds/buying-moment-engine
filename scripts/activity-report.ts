/**
 * Daily activity TL;DR — the report end of the analytics loop.
 *
 *   pnpm activity:report                 # last 24h -> Obsidian /analytics
 *   pnpm activity:report -- --hours 48   # widen the window
 *   pnpm activity:report -- --days 7     # last week
 *   pnpm activity:report -- --stdout     # print only, don't write a file
 *
 * Reads DATABASE_URL from `.env.local`. Pulls raw rows from `activity_events` and
 * derives EVERY number in the report from them in code — there are no stored
 * aggregates and nothing is estimated. Zero activity prints "No activity", never
 * a fabricated figure.
 *
 * Output lands in the Obsidian vault as `activity-YYYY-MM-DD.md` plus a rolling
 * `latest.md`, both a sub-3-minute read: TL;DR first, then per-org and per-person
 * tables, then the raw recent events for anyone who wants to audit a number.
 */
import { config } from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "@/db/client";
import { getActivitySince, type ActivityRow } from "@/db/activity";

config({ path: ".env.local" });

const OUTPUT_DIR = "/Users/love/Desktop/create/loops/analytics";

interface Options {
  hours: number;
  stdout: boolean;
}

function parseArgs(argv: string[]): Options {
  let hours = 24;
  let stdout = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--hours") hours = Number(argv[++i]);
    else if (arg === "--days") hours = Number(argv[++i]) * 24;
    else if (arg === "--stdout") stdout = true;
  }
  if (!Number.isFinite(hours) || hours <= 0) {
    console.error("Invalid window: --hours/--days must be a positive number.");
    process.exit(1);
  }
  return { hours, stdout };
}

/** 12-hour local time, e.g. "Jul 15, 2:14 PM" — matches how Lilly reads times. */
function fmtTime(d: Date): string {
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function fmtDateOnly(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** YYYY-MM-DD in local time, for the dated filename. */
function fileStamp(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface OrgRollup {
  orgDomain: string;
  people: Set<string>;
  signIns: number;
  pageViews: number;
  lastSeen: Date;
  pathCounts: Map<string, number>;
}

interface PersonRollup {
  email: string;
  orgDomain: string;
  signIns: number;
  pageViews: number;
  lastSeen: Date;
}

/**
 * Neutralize a value before it goes in a markdown table cell. `path` is
 * client-supplied (the beacon body), so a stray `|` or newline could otherwise
 * split or break a row and make the report misread. Escape pipes, flatten
 * whitespace — the report must stay trustworthy whatever gets logged.
 */
function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function topPaths(counts: Map<string, number>, n: number): string {
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  if (sorted.length === 0) return "—";
  return sorted.map(([p, c]) => `${cell(p)} (${c})`).join(", ");
}

function buildReport(rows: ActivityRow[], opts: Options, now: Date): string {
  const windowStart = new Date(now.getTime() - opts.hours * 3600_000);
  const windowLabel =
    opts.hours === 24
      ? "last 24 hours"
      : opts.hours % 24 === 0
        ? `last ${opts.hours / 24} days`
        : `last ${opts.hours} hours`;

  const header =
    `# Activity — ${fmtDateOnly(now)}\n\n` +
    `_Window: ${windowLabel} (since ${fmtTime(windowStart)}). Generated ${fmtTime(now)}._\n` +
    `_Source: \`activity_events\` in your Postgres. Every number below is a real logged row — nothing estimated._\n\n`;

  if (rows.length === 0) {
    return (
      header +
      `## TL;DR\n\n` +
      `**No activity in the ${windowLabel}.** No sign-ins and no page views were logged.\n\n` +
      `If you expected some, check that the app is deployed with the tracking build and that \`DATABASE_URL\` points at the same database the app writes to.\n`
    );
  }

  // --- Roll up per org and per person from the raw rows ---
  const orgs = new Map<string, OrgRollup>();
  const people = new Map<string, PersonRollup>();
  let signIns = 0;
  let pageViews = 0;

  for (const row of rows) {
    const occurred = new Date(row.occurredAt);
    if (row.eventType === "sign_in") signIns++;
    else pageViews++;

    let org = orgs.get(row.orgDomain);
    if (!org) {
      org = {
        orgDomain: row.orgDomain,
        people: new Set(),
        signIns: 0,
        pageViews: 0,
        lastSeen: occurred,
        pathCounts: new Map(),
      };
      orgs.set(row.orgDomain, org);
    }
    org.people.add(row.email);
    if (row.eventType === "sign_in") org.signIns++;
    else {
      org.pageViews++;
      if (row.path) org.pathCounts.set(row.path, (org.pathCounts.get(row.path) ?? 0) + 1);
    }
    if (occurred > org.lastSeen) org.lastSeen = occurred;

    let person = people.get(row.email);
    if (!person) {
      person = {
        email: row.email,
        orgDomain: row.orgDomain,
        signIns: 0,
        pageViews: 0,
        lastSeen: occurred,
      };
      people.set(row.email, person);
    }
    if (row.eventType === "sign_in") person.signIns++;
    else person.pageViews++;
    if (occurred > person.lastSeen) person.lastSeen = occurred;
  }

  const orgList = [...orgs.values()].sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());
  const personList = [...people.values()].sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());

  const mostActiveOrg = [...orgs.values()].sort(
    (a, b) => b.pageViews + b.signIns - (a.pageViews + a.signIns),
  )[0];

  const allPaths = new Map<string, number>();
  for (const org of orgs.values()) {
    for (const [p, c] of org.pathCounts) allPaths.set(p, (allPaths.get(p) ?? 0) + c);
  }
  const topPath = [...allPaths.entries()].sort((a, b) => b[1] - a[1])[0];

  // --- TL;DR ---
  let out = header;
  out += `## TL;DR\n\n`;
  out += `- **${signIns} sign-in${signIns === 1 ? "" : "s"}** and **${pageViews} page view${pageViews === 1 ? "" : "s"}** from **${people.size} ${people.size === 1 ? "person" : "people"}** across **${orgs.size} ${orgs.size === 1 ? "org" : "orgs"}**.\n`;
  if (mostActiveOrg) {
    out += `- Most active org: **${cell(mostActiveOrg.orgDomain)}** — ${mostActiveOrg.people.size} ${mostActiveOrg.people.size === 1 ? "person" : "people"}, ${mostActiveOrg.pageViews} page views, last seen ${fmtTime(mostActiveOrg.lastSeen)}.\n`;
  }
  if (topPath) {
    out += `- Most viewed page: **${cell(topPath[0])}** (${topPath[1]} view${topPath[1] === 1 ? "" : "s"}).\n`;
  }
  out += `\n`;

  // --- By org ---
  out += `## By org\n\n`;
  out += `| Org | People | Sign-ins | Page views | Last seen | Top pages |\n`;
  out += `|---|---|---|---|---|---|\n`;
  for (const org of orgList) {
    out += `| ${cell(org.orgDomain)} | ${org.people.size} | ${org.signIns} | ${org.pageViews} | ${fmtTime(org.lastSeen)} | ${topPaths(org.pathCounts, 3)} |\n`;
  }
  out += `\n`;

  // --- By person ---
  out += `## By person\n\n`;
  out += `| Person | Org | Sign-ins | Page views | Last seen |\n`;
  out += `|---|---|---|---|---|\n`;
  for (const p of personList) {
    out += `| ${cell(p.email)} | ${cell(p.orgDomain)} | ${p.signIns} | ${p.pageViews} | ${fmtTime(p.lastSeen)} |\n`;
  }
  out += `\n`;

  // --- Raw recent events (audit trail: every headline number traces to here) ---
  const recent = rows.slice(-25).reverse();
  out += `## Recent events (newest first)\n\n`;
  out += `<sub>Newest ${recent.length} of ${rows.length} in-window events.</sub>\n\n`;
  out += `| When | Event | Person | Org | Path |\n`;
  out += `|---|---|---|---|---|\n`;
  for (const row of recent) {
    const when = fmtTime(new Date(row.occurredAt));
    const event = row.eventType === "sign_in" ? "sign-in" : "view";
    out += `| ${when} | ${event} | ${cell(row.email)} | ${cell(row.orgDomain)} | ${row.path ? cell(row.path) : "—"} |\n`;
  }
  out += `\n`;

  return out;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set (checked .env.local). Aborting — no report written.");
    process.exit(1);
  }

  const now = new Date();
  const since = new Date(now.getTime() - opts.hours * 3600_000);
  const rows = await getActivitySince(getDb(), since);
  const report = buildReport(rows, opts, now);

  if (opts.stdout) {
    process.stdout.write(report);
    process.exit(0);
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const datedPath = join(OUTPUT_DIR, `activity-${fileStamp(now)}.md`);
  const latestPath = join(OUTPUT_DIR, "latest.md");
  writeFileSync(datedPath, report, "utf8");
  writeFileSync(latestPath, report, "utf8");

  console.log(`✓ Activity report written (${rows.length} events in window):`);
  console.log(`  ${datedPath}`);
  console.log(`  ${latestPath}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Activity report failed:", err);
  process.exit(1);
});
