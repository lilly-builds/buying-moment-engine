/**
 * Thread 17 verification helper: run the three detector registry sources against
 * demo metros, with Adzuna scoped by metro (`where`) and all fetches metered.
 *
 *   npx tsx scripts/run-detectors.ts --dry-run
 *   npx tsx scripts/run-detectors.ts --metro "Austin, TX"
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { getDb } from "@/db/client";
import { drizzleCostRecorder } from "@/db/cost-recorder";
import { feedPractices } from "@/db/queries";
import { runDetectors } from "@/jobs/run-detectors";
import { createGrowthEventsDetector } from "@/src/detectors/growth-events";
import { fetchGdeltArticles } from "@/src/detectors/growth-events-gdelt";
import { createStaffingSpikeDetector } from "@/src/detectors/staffing-spike";
import { fetchAdzunaJobs } from "@/src/detectors/staffing-spike-adzuna";
import { createPhoneComplaintsDetector } from "@/src/detectors/phone-complaints";
import { fetchGooglePlaceDetails } from "@/src/detectors/phone-complaints-google-places";
import { createMeter, type CostEventRecord, type CostRecorder } from "@/src/roi/cost-meter";
import { crossCheckSignals } from "@/src/engine/cross-check";
import { signals, rawSignals, costEvents, practices } from "@/db/schema";
import { count, eq, sql } from "drizzle-orm";

const DEMO_METROS = ["Austin, TX", "Houston, TX", "Dallas, TX", "Charlotte, NC", "Tampa, FL", "Phoenix, AZ"];
const SPECIALTY_TERMS = [
  "medical receptionist",
  "front desk medical",
  "patient coordinator",
  "medical scheduler",
  "call center medical",
  "dermatology receptionist",
  "orthopedics receptionist",
  "ophthalmology receptionist",
  "OBGYN receptionist",
];

interface Args { dryRun: boolean; metro?: string; crossCheckLimit: number }

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  return {
    dryRun: argv.includes("--dry-run"),
    metro: get("--metro"),
    crossCheckLimit: Number(get("--cross-check-limit") ?? 10),
  };
}

function teeRecorder(inner: CostRecorder): { recorder: CostRecorder; sink: CostEventRecord[] } {
  const sink: CostEventRecord[] = [];
  return {
    sink,
    recorder: {
      async record(row) {
        sink.push(row);
        await inner.record(row);
      },
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const metros = args.metro ? [args.metro] : DEMO_METROS;
  const staffingQueries = metros.flatMap((metro) =>
    SPECIALTY_TERMS.map((term) => ({
      what: term,
      where: metro,
      page: 1,
    })),
  );
  const growthQueries = metros.map((metro) => ({
    query: `(${metro.replace(",", "")} OR ${JSON.stringify(metro)}) (dermatology OR orthopedics OR ophthalmology OR OBGYN OR clinic OR "medical group") (acquired OR acquisition OR "private equity" OR merger OR "opens new location" OR "opens second location" OR expansion OR "adds new provider" OR "welcomes new provider")`,
    maxRecords: 75,
  }));

  console.log("── detector run (Thread 17) ───────────────────────────────────");
  console.log(`metros: ${metros.join("; ")}`);
  console.log(`Adzuna calls: ${staffingQueries.length} (free-tier unit cost recorded as $0)`);
  console.log(`GDELT calls:  ${growthQueries.length} (free API, recorded as $0)`);
  console.log("Google phone detector: no broad run; per-place phone checks happen in cross-check/discovery.");

  if (args.dryRun) {
    console.log("\n--dry-run: plan only. ZERO network calls, ZERO writes.");
    return;
  }

  const missing = ["DATABASE_URL", "ADZUNA_APP_ID", "ADZUNA_APP_KEY"].filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`missing env: ${missing.join(", ")}`);

  const db = getDb();
  const tee = teeRecorder(drizzleCostRecorder(db));
  const meter = createMeter(tee.recorder);
  const now = new Date();

  const detectorSummary = await runDetectors({
    db,
    meter,
    now,
    detectors: [
      createStaffingSpikeDetector(fetchAdzunaJobs, { queries: staffingQueries }),
      createPhoneComplaintsDetector(fetchGooglePlaceDetails, []),
      createGrowthEventsDetector(fetchGdeltArticles, { queries: growthQueries }),
    ],
  });

  const feed = await feedPractices(db, now);
  for (const row of feed.slice(0, args.crossCheckLimit)) {
    await crossCheckSignals({ db, meter, now }, row.id);
  }

  const rawByKind = await db.select({ kind: rawSignals.detectorKind, n: count() }).from(rawSignals).groupBy(rawSignals.detectorKind);
  const sigByKind = await db.select({ kind: signals.kind, n: count() }).from(signals).groupBy(signals.kind);
  const costByProvider = await db.select({ provider: costEvents.provider, n: count(), usd: sql<string>`coalesce(sum(${costEvents.costUsd}), 0)` }).from(costEvents).groupBy(costEvents.provider);
  const multi = await db
    .select({ id: practices.id, name: practices.name, kinds: sql<number>`count(distinct ${signals.kind})::int` })
    .from(practices)
    .innerJoin(signals, eq(signals.practiceId, practices.id))
    .groupBy(practices.id, practices.name)
    .having(sql`count(distinct ${signals.kind}) >= 2`);

  console.log("\nrunDetectors summary:");
  console.log(JSON.stringify(detectorSummary, null, 2));
  console.log("\nraw_signals by kind:", rawByKind);
  console.log("signals by kind:", sigByKind);
  console.log("cost_events by provider:", costByProvider);
  console.log("multi-kind practices:", multi.slice(0, 10));
  console.log(`this script recorded ${tee.sink.length} cost rows totaling $${tee.sink.reduce((t, r) => t + r.costUsd, 0).toFixed(4)}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
