/**
 * Experiment #2 — mechanism A/B: agentic browsing vs scrape-then-extract.
 *
 *   npx tsx scripts/experiment-2-mechanism-ab.ts --dry-run
 *   npx tsx scripts/experiment-2-mechanism-ab.ts --cohort ./experiment-1-cohort.json \
 *     --out ./experiment-2-results.jsonl --only schlessinger-md-dermatology,...
 *
 * SAME PRACTICES, BOTH ARCHITECTURES. The `B` arm is not a new cohort: three of these
 * keys already sit in `experiment-1-results.jsonl` with agentic numbers next to them
 * ($1.2892, $1.2475, and one $0.0000 that actually cost $1.27 and vanished when the
 * socket died). Re-running exactly those practices is the only comparison worth making.
 *
 * WHAT IT SPENDS: one Haiku 4.5 call per practice, ~$0.01 each. NOTHING ELSE.
 *   - No PDL. The provider split was measured in experiment #1 and PDL answers none of
 *     the questions this run asks (cost, latency, citation closure, escalation rate).
 *   - No escalation. The budget is ZERO: every practice that WOULD have escalated is
 *     recorded as such, for free. A cap of 3 would quietly authorize $3.81 on a run
 *     meant to cost $0.05.
 *   - `--dry-run` validates the cohort and the environment and makes ZERO paid calls.
 *
 * D9: read-only public business pages, robots-checked, honest UA. Nothing is contacted.
 *
 * RESULTS ARE NOT IN THIS FILE, and the results file is gitignored: it carries real
 * people's names, and the repo is public. Nothing here hardcodes a finding.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { verifyFindings, type DroppedFact } from "@/src/enrich/citations";
import { EXTRACT_MODEL } from "@/src/enrich/config";
import { anthropicExtractClient, runExtract } from "@/src/enrich/extract";
import { scrapePractice } from "@/src/enrich/scrape";
import type { CohortEntry } from "@/src/enrich/experiment-metrics";
import type { ResearchFindings } from "@/src/enrich/types";
import { createMeter, type CostEventRecord } from "@/src/roi/cost-meter";

/** The 3 practices already in the agentic ledger + 2 unrun. Lilly's call: 5, not 40. */
const DEFAULT_KEYS = [
  "schlessinger-md-dermatology",
  "charleston-womens-wellness",
  "westlake-dermatology",
  "virginia-womens-center",
  "wnc-ophthalmology",
];

interface Args {
  cohort: string;
  out: string;
  only: string[];
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const only = get("--only");
  return {
    cohort: get("--cohort") ?? "./experiment-1-cohort.json",
    out: get("--out") ?? "./experiment-2-results.jsonl",
    only: only ? only.split(",").map((k) => k.trim()) : DEFAULT_KEYS,
    dryRun: argv.includes("--dry-run"),
  };
}

interface MechanismRecord {
  key: string;
  name: string;
  ranAt: string;
  ok: boolean;
  error: string | null;
  /** Wall time, split so a slow SITE is never mistaken for a slow MODEL. */
  scrapeMs: number;
  extractMs: number;
  totalMs: number;
  pagesHeld: number;
  totalChars: number;
  scrapeFailure: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  factsVerified: number;
  factsDropped: number;
  drops: Array<Pick<DroppedFact, "field" | "reason">>;
  decisionMaker: "named" | "role_only" | "none";
  /** What WOULD have escalated. Costs nothing to observe; $1.27 to act on. */
  escalationTrigger: "thin-scrape" | "extract-failed" | "no-verified-facts" | null;
}

/** Cited facts, not `practice_facts` rows: the contact's role/name/email/LinkedIn count. */
function countFacts(findings: ResearchFindings): number {
  const dm = findings.decisionMaker;
  return (
    Object.values(findings.firmographics).filter((f) => f !== undefined).length +
    (findings.ehr === null ? 0 : 1) +
    findings.incumbentTooling.length +
    findings.buyingMomentContext.length +
    (dm === null ? 0 : 1 + (dm.name ? 1 : 0) + (dm.email ? 1 : 0) + (dm.linkedinUrl ? 1 : 0))
  );
}

async function runEntry(entry: CohortEntry, apiKey: string): Promise<MechanismRecord> {
  const spend: CostEventRecord[] = [];
  const meter = createMeter({ record: async (row) => void spend.push(row) });
  const started = Date.now();

  const base: MechanismRecord = {
    key: entry.key,
    name: entry.name,
    ranAt: new Date().toISOString(),
    ok: false,
    error: null,
    scrapeMs: 0,
    extractMs: 0,
    totalMs: 0,
    pagesHeld: 0,
    totalChars: 0,
    scrapeFailure: null,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    factsVerified: 0,
    factsDropped: 0,
    drops: [],
    decisionMaker: "none",
    escalationTrigger: null,
  };

  if (!entry.websiteUrl) {
    return { ...base, error: "no website url", escalationTrigger: "thin-scrape", totalMs: 0 };
  }

  const scrapeStart = Date.now();
  const scraped = await scrapePractice({ fetch }, entry.websiteUrl);
  const scrapeMs = Date.now() - scrapeStart;

  if (scraped.pagesHeld === 0) {
    return {
      ...base,
      scrapeMs,
      totalMs: Date.now() - started,
      scrapeFailure: scraped.reason ?? "empty",
      error: `scrape yielded no usable text (${scraped.reason ?? "empty"})`,
      escalationTrigger: "thin-scrape",
    };
  }

  const held = {
    ...base,
    scrapeMs,
    pagesHeld: scraped.pagesHeld,
    totalChars: scraped.totalChars,
  };

  const extractStart = Date.now();
  let outcome;
  try {
    outcome = await runExtract(
      { client: anthropicExtractClient(apiKey), meter },
      {
        practiceName: entry.name,
        city: entry.city,
        state: entry.state,
        pages: scraped.pages,
      },
    );
  } catch (err) {
    // A thrown call is UNBILLED and says nothing about the practice (KTD-7).
    return {
      ...held,
      extractMs: Date.now() - extractStart,
      totalMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
      escalationTrigger: null,
    };
  }
  const extractMs = Date.now() - extractStart;

  const priced = {
    ...held,
    extractMs,
    totalMs: Date.now() - started,
    inputTokens: outcome.usage.inputTokens,
    outputTokens: outcome.usage.outputTokens,
    costUsd: spend.reduce((t, r) => t + r.costUsd, 0),
  };

  if (!outcome.ok) {
    return { ...priced, error: outcome.reason, escalationTrigger: "extract-failed" };
  }

  const { verified, dropped } = verifyFindings(outcome.findings, scraped.pages);
  const factsVerified = countFacts(verified);
  const record = {
    ...priced,
    ok: factsVerified > 0,
    factsVerified,
    factsDropped: dropped.length,
    drops: dropped.map((d) => ({ field: d.field, reason: d.reason })),
    decisionMaker: (verified.decisionMaker === null
      ? "none"
      : verified.decisionMaker.name
        ? "named"
        : "role_only") as MechanismRecord["decisionMaker"],
  };

  return factsVerified === 0
    ? { ...record, error: "no verified facts", escalationTrigger: "no-verified-facts" }
    : record;
}

function readCohort(path: string): CohortEntry[] {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(raw)) throw new Error(`${path} must be a JSON array`);
  return raw as CohortEntry[];
}

function summarize(records: MechanismRecord[]): void {
  const ok = records.filter((r) => r.ok);
  const total = records.reduce((t, r) => t + r.costUsd, 0);
  const triggers = records.filter((r) => r.escalationTrigger !== null);

  console.log(`\n${"─".repeat(78)}`);
  console.log(`SCRAPE-THEN-EXTRACT — ${EXTRACT_MODEL} — n=${records.length}`);
  console.log("─".repeat(78));
  for (const r of records) {
    const cost = `$${r.costUsd.toFixed(4)}`.padStart(9);
    const secs = `${(r.totalMs / 1000).toFixed(1)}s`.padStart(7);
    const facts = `${r.factsVerified}v/${r.factsDropped}d`.padStart(7);
    console.log(
      `  ${r.key.padEnd(32)} ${cost} ${secs} ${facts}  pages=${String(r.pagesHeld).padStart(2)}` +
        `  dm=${r.decisionMaker.padEnd(9)}${r.error ? ` ERROR: ${r.error}` : ""}`,
    );
    for (const d of r.drops) console.log(`      DROPPED  ${d.field}  (${d.reason})`);
  }
  console.log("─".repeat(78));
  console.log(`  practices with >=1 verified fact   ${ok.length} / ${records.length}`);
  console.log(`  total spend                        $${total.toFixed(4)}`);
  console.log(`  mean cost / practice               $${(total / records.length).toFixed(4)}`);
  console.log(`  mean wall / practice               ${(records.reduce((t, r) => t + r.totalMs, 0) / records.length / 1000).toFixed(1)}s`);
  console.log(`  facts verified                     ${records.reduce((t, r) => t + r.factsVerified, 0)}`);
  console.log(`  facts DROPPED (uncitable)          ${records.reduce((t, r) => t + r.factsDropped, 0)}`);
  console.log(`  decision-maker named               ${records.filter((r) => r.decisionMaker === "named").length}`);
  console.log(`  escalation WOULD have fired        ${triggers.length} / ${records.length}  (budget was 0; $0 spent)`);
  for (const r of triggers) console.log(`      ${r.key}: ${r.escalationTrigger}`);
  console.log("─".repeat(78));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cohort = readCohort(args.cohort);
  const targets = cohort.filter((e) => args.only.includes(e.key));

  const missing = args.only.filter((k) => !cohort.some((e) => e.key === k));
  if (missing.length > 0) throw new Error(`keys not in cohort: ${missing.join(", ")}`);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  console.log(`cohort ${args.cohort} · ${targets.length} practices · out ${args.out}`);
  for (const e of targets) console.log(`  ${e.key.padEnd(32)} ${e.websiteUrl ?? "(no website)"}`);

  if (args.dryRun) {
    console.log(`\nDRY RUN — cohort and key validated. ZERO paid calls made.`);
    console.log(`Estimated live cost: ~$${(targets.length * 0.011).toFixed(3)} (${targets.length} x one Haiku 4.5 call).`);
    return;
  }

  // Append-only: a crash on practice 4 never loses 1-3, and never re-pays for them.
  const done = existsSync(args.out)
    ? new Set(
        readFileSync(args.out, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => (JSON.parse(line) as MechanismRecord).key),
      )
    : new Set<string>();

  const records: MechanismRecord[] = [];
  for (const entry of targets) {
    if (done.has(entry.key)) {
      console.log(`\n· ${entry.key} — already in ${args.out}, skipping (no re-spend)`);
      continue;
    }
    console.log(`\n· ${entry.key}`);
    const record = await runEntry(entry, apiKey);
    appendFileSync(args.out, `${JSON.stringify(record)}\n`);
    records.push(record);
    console.log(
      `  pages=${record.pagesHeld} chars=${record.totalChars} ` +
        `tokens=${record.inputTokens}/${record.outputTokens} $${record.costUsd.toFixed(4)} ` +
        `${(record.totalMs / 1000).toFixed(1)}s`,
    );
  }

  if (records.length > 0) summarize(records);
}

void main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exitCode = 1;
});
