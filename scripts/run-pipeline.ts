/**
 * The seeding run (U6) — pull real practices that are at a buying moment but have no
 * brief yet, and drive each through the conductor (resolve → website → enrich → synthesize
 * → persist). This is what finally produces real briefs for the feed (U15).
 *
 *   npm run pipeline -- --dry-run            # list the pull, ZERO paid calls
 *   npm run pipeline -- --limit 3            # brief the 3 hottest (cost-disciplined first run)
 *   npm run pipeline -- --limit 3 --force    # regenerate even practices already briefed
 *
 * COST DISCIPLINE: `--dry-run` makes zero paid calls. `--limit` caps the cohort. Every paid
 * call (Places website lookup, Claude extract, PDL, Opus synthesize) flows through ONE meter
 * into `cost_events` (R19); the summary prints real $/brief. The agentic $1.27 escalation is
 * intentionally OFF — cheap real websites (Plan A/B) feed the free scrape path.
 *
 * ERROR ISOLATION: one practice failing is logged and skipped; it never kills the batch.
 * IDEMPOTENT: a practice that already has a current brief is skipped, spending nothing.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { getDb } from "@/db/client";
import { drizzleCostRecorder } from "@/db/cost-recorder";
import { practicesNeedingBriefs } from "@/db/queries";
import { anthropicVoiceClient } from "@/src/brief/voice";
import { crossCheckSignals } from "@/src/engine/cross-check";
import { runPipelineBatch } from "@/src/engine/pipeline-batch";
import type { Lead, PipelineDeps } from "@/src/engine/pipeline";
import { anthropicExtractClient } from "@/src/enrich/extract";
import { pdlClient } from "@/src/enrich/pdl-client";
import { scrapePractice } from "@/src/enrich/scrape";
import { teeRecorder } from "@/src/enrich/experiment-run";
import { resolvePracticeWebsite } from "@/src/enrich/website";
import { createMeter, type CostEventRecord } from "@/src/roi/cost-meter";

const REQUIRED_ENV_LIVE = [
  "ANTHROPIC_API_KEY",
  "PDL_API_KEY",
  "DATABASE_URL",
  "GOOGLE_PLACES_API_KEY",
] as const;

interface Args {
  dryRun: boolean;
  force: boolean;
  limit?: number;
}

function parseArgs(argv: string[]): Args {
  const limitRaw = (() => {
    const i = argv.indexOf("--limit");
    return i === -1 ? undefined : argv[i + 1];
  })();
  const limit = limitRaw === undefined ? undefined : Number(limitRaw);
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error(`--limit must be a positive integer, got "${limitRaw}"`);
  }
  return {
    dryRun: argv.includes("--dry-run"),
    force: argv.includes("--force"),
    limit,
  };
}

function spendForPractice(sink: CostEventRecord[], practiceId: string | null): number {
  if (!practiceId) return 0;
  return sink
    .filter((r) => r.practiceId === practiceId)
    .reduce((total, r) => total + r.costUsd, 0);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required (even for --dry-run — it reads the pull).");
    process.exit(1);
  }
  const db = getDb();

  // --force: pull already-briefed practices too, and the conductor rewrites them
  // (a briefed practice is otherwise excluded from the pull AND skipped by the conductor).
  const pull = await practicesNeedingBriefs(db, {
    limit: args.limit,
    includeBriefed: args.force,
  });
  console.log(
    `practices at a buying moment with no brief: ${pull.length}${args.limit ? ` (limit ${args.limit})` : ""}`,
  );
  for (const p of pull) {
    console.log(
      `  - ${p.name} [${p.city ?? "?"}, ${p.state ?? "?"}] · ${p.freshSignalCount} fresh signal(s) · website ${p.websiteUrl ? "on file" : "missing → Plan B"}`,
    );
  }

  if (args.dryRun) {
    const missing = REQUIRED_ENV_LIVE.filter((k) => !process.env[k]);
    console.log(
      missing.length
        ? `\nDRY RUN — a live run would fail: missing env ${missing.join(", ")}`
        : "\nDRY RUN — env valid. Zero paid calls made.",
    );
    return;
  }

  const missing = REQUIRED_ENV_LIVE.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`missing env: ${missing.join(", ")} (use --dry-run to validate)`);
    process.exit(1);
  }
  const anthropicKey = process.env.ANTHROPIC_API_KEY as string;
  const pdlKey = process.env.PDL_API_KEY as string;

  if (pull.length === 0) {
    console.log("\nnothing to brief. Done.");
    return;
  }

  const sink: CostEventRecord[] = [];
  const meter = createMeter(teeRecorder(drizzleCostRecorder(db), sink));
  const deps: PipelineDeps = {
    db,
    meter,
    scrape: (url) => scrapePractice({ fetch }, url),
    extract: anthropicExtractClient(anthropicKey),
    pdl: pdlClient(pdlKey),
    voice: anthropicVoiceClient(anthropicKey),
    // Plan B: bound with the shared meter so its Places spend attributes per practice.
    resolveWebsite: (p) => resolvePracticeWebsite({ meter, practiceId: p.id }, p),
    crossCheck: (practiceId) => crossCheckSignals({ db, meter, now: new Date() }, practiceId),
    force: args.force,
    // escalation intentionally OFF — cost discipline (see file header).
  };

  const leads: Lead[] = pull.map((p) => ({
    name: p.name,
    geoKey: p.geoKey,
    city: p.city,
    state: p.state,
    websiteUrl: p.websiteUrl,
  }));

  console.log(`\nrunning ${leads.length} practice(s) through the conductor…\n`);
  const summary = await runPipelineBatch(deps, leads);

  console.log("\n── run summary ──");
  console.log(
    `total ${summary.total} · briefed ${summary.briefed} · skipped ${summary.skipped} · failed ${summary.failed} · errored ${summary.errored}`,
  );
  const totalSpend = sink.reduce((total, r) => total + r.costUsd, 0);
  console.log(`total spend: $${totalSpend.toFixed(4)}`);
  if (summary.briefed > 0) {
    console.log(
      `~$/brief: $${(totalSpend / summary.briefed).toFixed(4)} (over ${summary.briefed} briefed)`,
    );
  }
  console.log("\nper practice:");
  for (const item of summary.items) {
    const spend = spendForPractice(sink, item.practiceId).toFixed(4);
    const r = item.result;
    const detail =
      r?.status === "briefed"
        ? `brief ${r.brief?.status}, ${r.brief?.signalCount} signal(s), enrich ${r.enrich?.status}, website ${r.website ? "yes" : "none"}`
        : (item.error ?? r?.reason ?? "");
    console.log(`  [${item.status}] ${item.name} · $${spend}${detail ? ` · ${detail}` : ""}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
