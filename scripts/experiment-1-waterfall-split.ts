/**
 * Stack-validation experiment #1 — "Enrichment: Claude (Sonnet 5) vs PDL, for
 * company data AND person data." Decides the exact waterfall split (spec § Stack-
 * validation). Run ONCE, during U5, with live keys.
 *
 *   npx tsx scripts/experiment-1-waterfall-split.ts \
 *     --cohort ./experiment-1-cohort.json \
 *     --out    ./experiment-1-results.jsonl
 *
 *   npx tsx scripts/experiment-1-waterfall-split.ts --cohort ... --dry-run
 *
 * COHORT — a JSON array of exactly 10 entries (schema: `src/enrich/experiment-metrics.ts`):
 *   { "key", "name", "city", "state", "geoKey", "websiteUrl"?,
 *     "locationsCount", "verticalHint" }
 *
 * Stratified, not random: >= 5 small (1-2 locations) + >= 5 mid/large (3+),
 * spanning >= 2 verticals. A random n=10 would very likely miss the build plan's
 * named small-practice-coverage risk (experiment #4 folds into this one). The
 * stratification is VALIDATED before a cent is spent. `--dry-run` checks the
 * cohort and the environment and makes ZERO paid calls.
 *
 * APPEND-ONLY + RESUMABLE: one JSON object per line, flushed after each practice.
 * A second tranche skips every `key` already present and merges into the same file
 * rather than redoing (and re-paying for) work. A crash on record 7 never loses 1-6.
 *
 * EVERY PAID CALL IS METERED (R19) into `cost_events` — see `experiment-run.ts`.
 *
 * RESULTS ARE NOT IN THIS FILE. Nothing here hardcodes a cohort, a hit-rate, or a
 * finding. The orchestrator supplies the cohort and runs it with live keys; the
 * summary below is computed from the results file every time it runs.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { getDb } from "@/db/client";
import { drizzleCostRecorder } from "@/db/cost-recorder";
import { resolvePractice } from "@/src/engine/resolver";
import { anthropicResearchClient } from "@/src/enrich/anthropic-client";
import {
  parseRecords,
  summarize,
  validateCohort,
} from "@/src/enrich/experiment-metrics";
import { runCohortEntry } from "@/src/enrich/experiment-run";
import { pdlClient } from "@/src/enrich/pdl-client";

const REQUIRED_ENV = ["ANTHROPIC_API_KEY", "PDL_API_KEY", "DATABASE_URL"] as const;

interface Args {
  cohort: string;
  out: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const cohort = get("--cohort");
  if (!cohort) throw new Error("missing --cohort <path-to-cohort.json>");
  return {
    cohort,
    out: get("--out") ?? "./experiment-1-results.jsonl",
    dryRun: argv.includes("--dry-run"),
  };
}

function loadDoneKeys(out: string): Set<string> {
  if (!existsSync(out)) return new Set();
  return new Set(parseRecords(readFileSync(out, "utf8")).map((r) => r.key));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const validation = validateCohort(
    JSON.parse(readFileSync(args.cohort, "utf8")),
  );
  if (!validation.ok) {
    console.error(`cohort invalid: ${validation.reason}`);
    process.exit(1);
  }
  const cohort = validation.cohort;

  const done = loadDoneKeys(args.out);
  const todo = cohort.filter((entry) => !done.has(entry.key));
  console.log(
    `cohort ok: ${cohort.length} practices · ${todo.length} to run · ${done.size} already done`,
  );

  if (args.dryRun) {
    const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
    console.log(
      missing.length
        ? `DRY RUN — a live run would fail: missing env ${missing.join(", ")}`
        : "DRY RUN — cohort and env valid. Zero paid calls made.",
    );
    return;
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const pdlKey = process.env.PDL_API_KEY;
  if (!anthropicKey || !pdlKey) {
    console.error(
      "ANTHROPIC_API_KEY and PDL_API_KEY are required for a live run (use --dry-run to validate)",
    );
    process.exit(1);
  }

  const db = getDb();
  const clients = {
    research: anthropicResearchClient(anthropicKey),
    pdl: pdlClient(pdlKey),
    recorder: drizzleCostRecorder(db),
  };

  for (const entry of todo) {
    const { practiceId } = await resolvePractice(db, {
      name: entry.name,
      geoKey: entry.geoKey,
      city: entry.city,
      state: entry.state,
    });
    const record = await runCohortEntry(entry, clients, practiceId);
    appendFileSync(args.out, `${JSON.stringify(record)}\n`);

    const pdlPerson = record.pdlPerson.attempted
      ? String(record.pdlPerson.matched)
      : "skipped";
    console.log(
      `${entry.key}: claude=${record.claude.ok ? "ok" : "FAIL"} · pdlCompany=${record.pdlCompany.matched} · pdlPerson=${pdlPerson}`,
    );
  }

  const summary = summarize(parseRecords(readFileSync(args.out, "utf8")));
  console.log(
    "\n── experiment #1 summary (computed from the results file, never hardcoded) ──",
  );
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
