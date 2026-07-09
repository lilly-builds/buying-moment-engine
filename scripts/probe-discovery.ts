/**
 * U7 — live end-to-end probe for the Google Places discovery source.
 *
 *   npx tsx scripts/probe-discovery.ts --dry-run           # validate env + plan, ZERO paid calls
 *   npx tsx scripts/probe-discovery.ts                     # live run: EliseAI, first metro, all ICPs
 *   npx tsx scripts/probe-discovery.ts --metro "Tampa, FL" --icp dermatology --limit 12 --target 5
 *
 * This is the VERIFY artifact, not a unit test, and NOT wired into the cron — run by
 * hand. It runs the REAL discovery pipeline against the LIVE Google Places + Anthropic
 * APIs, writing to the REAL database, so qualified prospects land on the dashboard feed
 * (app/page.tsx) and every paid call persists a cost_events row (R6/R19). Goal: surface
 * real EliseAI prospects whose reviews evidence phone-access pain.
 *
 * COST: metered and printed. Bounded by (ICP categories) × (--limit per category) ×
 * (1 Text Search ~$0.032 + 1 Details ~$0.04 + a few tiny Haiku classify calls). The
 * rating funnel skips well-rated places before the expensive step, so real spend is
 * well under the worst case. Cost is not a blocker (Lilly's call), but it is TRACKED.
 *
 * POSITIVE CONTROL: if zero places are enumerated (a REQUEST_DENIED key, an
 * auth-redirect-shaped 200, or a dead endpoint), the probe FAILS LOUDLY rather than
 * reporting a hollow success — see the fetch-auth-redirect caution.
 *
 * Google ToS (R5): review text is sent to the qualifier in memory only; nothing
 * persisted here holds it.
 */

import { config } from "dotenv";
import { getDb } from "@/db/client";
import { feedPractices } from "@/db/queries";
import { createMeter, type CostEventRecord, type CostRecorder } from "@/src/roi/cost-meter";
import { drizzleCostRecorder } from "@/db/cost-recorder";
import { getTenantProfile, type TenantProfile } from "@/src/discovery/tenants";
import { buildLiveDiscoveryDeps, runDiscovery } from "@/jobs/run-discovery";

config({ path: ".env.local" });

const TENANT_ID = "eliseai";

interface Args {
  metro?: string;
  icp?: string;
  limit: number;
  target: number;
  confidenceFloor?: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  return {
    metro: get("--metro"),
    icp: get("--icp"),
    limit: Number(get("--limit") ?? 10),
    target: Number(get("--target") ?? 5),
    confidenceFloor: get("--confidence") ? Number(get("--confidence")) : undefined,
    dryRun: argv.includes("--dry-run"),
  };
}

/** Restrict a profile to a single ICP category (by category or vertical), if asked. */
function narrowIcp(tenant: TenantProfile, icp: string | undefined): TenantProfile {
  if (!icp) return tenant;
  const filtered = tenant.icp.filter(
    (entry) => entry.category === icp || entry.vertical === icp,
  );
  if (filtered.length === 0) {
    const known = tenant.icp.map((e) => `${e.category} (${e.vertical})`).join(", ");
    throw new Error(`--icp "${icp}" matched no ICP category. Known: ${known}`);
  }
  return { ...tenant, icp: filtered };
}

/** A recorder that persists to cost_events AND accumulates a running total for the console. */
function teeRecorder(inner: CostRecorder): {
  recorder: CostRecorder;
  totalUsd: () => number;
  byStep: () => Record<string, { count: number; usd: number }>;
} {
  let total = 0;
  const byStep: Record<string, { count: number; usd: number }> = {};
  return {
    recorder: {
      async record(row: CostEventRecord): Promise<void> {
        total += row.costUsd;
        const bucket = (byStep[row.pipelineStep] ??= { count: 0, usd: 0 });
        bucket.count += 1;
        bucket.usd += row.costUsd;
        await inner.record(row);
      },
    },
    totalUsd: () => total,
    byStep: () => byStep,
  };
}

function usd(n: number): string {
  return `$${n.toFixed(4)}`;
}

function maskDb(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // ── Environment gate ────────────────────────────────────────────────────────
  const missing = ["DATABASE_URL", "GOOGLE_PLACES_API_KEY", "ANTHROPIC_API_KEY"].filter(
    (k) => !process.env[k],
  );
  if (missing.length > 0) {
    console.error(`Missing env (checked .env.local): ${missing.join(", ")}. Aborting — nothing written.`);
    process.exit(1);
  }

  const tenant = narrowIcp(getTenantProfile(TENANT_ID), args.icp);
  const metro = args.metro ?? tenant.metros[0];
  const now = new Date();

  console.log("── Discovery probe (U7) ─────────────────────────────────────────");
  console.log(`  tenant:      ${tenant.id}`);
  console.log(`  database:    ${maskDb(process.env.DATABASE_URL as string)}`);
  console.log(`  metro:       ${metro}`);
  console.log(`  ICP:         ${tenant.icp.map((e) => e.category).join(", ")}`);
  console.log(`  per-cat cap: ${args.limit}   confidence floor: ${args.confidenceFloor ?? "default"}`);
  console.log(`  target:      ${args.target} qualified prospects`);
  console.log(
    `  cost ceiling ~ ${usd(tenant.icp.length * (0.032 + args.limit * 0.04))} (funnel makes real spend much lower)`,
  );

  if (args.dryRun) {
    console.log("\n--dry-run: env + plan validated. ZERO paid calls made. Exiting.");
    process.exit(0);
  }

  // ── Live run ────────────────────────────────────────────────────────────────
  const db = getDb();
  const tee = teeRecorder(drizzleCostRecorder(db));
  const meter = createMeter(tee.recorder);

  const deps = buildLiveDiscoveryDeps({
    db,
    now,
    tenant,
    metro,
    limit: args.limit,
    confidenceFloor: args.confidenceFloor,
    meter,
    logger: (event, meta) => console.log(`  · ${event}`, meta ?? {}),
  });

  console.log("\nRunning… (each · line is a live decision/diagnostic)\n");
  const summary = await runDiscovery(deps);

  // ── Positive control ─────────────────────────────────────────────────────────
  if (summary.enumerated === 0) {
    console.error(
      "\n✗ POSITIVE CONTROL FAILED: zero places enumerated. Likely a denied/misconfigured " +
        "GOOGLE_PLACES_API_KEY (legacy Places API not enabled), or an auth-redirect 200. " +
        "Check the `discovery.search.status` lines above (REQUEST_DENIED?). Not reporting success.",
    );
    process.exit(1);
  }

  // ── Report ────────────────────────────────────────────────────────────────────
  console.log("\n── Result ───────────────────────────────────────────────────────");
  console.log(
    `  enumerated ${summary.enumerated} · funnel-dropped ${summary.funneledOut} · ` +
      `cached ${summary.cached} · checked ${summary.checked} · ` +
      `qualified ${summary.qualified} · archived ${summary.archived} · errored ${summary.errored}`,
  );

  console.log("\n  Qualified prospects (now on the feed):");
  if (summary.qualifiedPlaces.length === 0) {
    console.log("    (none this run)");
  } else {
    for (const p of summary.qualifiedPlaces) {
      console.log(
        `    • ${p.practiceHint}  [${p.category}, conf ${p.confidence.toFixed(2)}]  practice=${p.practiceId}`,
      );
    }
  }

  // Confirm they are actually feed-visible (the dashboard reads this exact query).
  const feed = await feedPractices(db, now);
  const qualifiedIds = new Set(summary.qualifiedPlaces.map((p) => p.practiceId));
  const onFeed = feed.filter((row) => qualifiedIds.has(row.id));
  console.log(`\n  Feed check: ${onFeed.length}/${summary.qualified} qualified prospects visible in feedPractices().`);

  console.log("\n  Cost (metered → cost_events):");
  for (const [step, b] of Object.entries(tee.byStep())) {
    console.log(`    ${step.padEnd(20)} ${String(b.count).padStart(3)} calls   ${usd(b.usd)}`);
  }
  console.log(`    ${"TOTAL".padEnd(20)} ${String(summary.calls.search + summary.calls.details + summary.calls.classify).padStart(3)} calls   ${usd(tee.totalUsd())}`);

  console.log("\n──────────────────────────────────────────────────────────────────");
  if (summary.qualified >= args.target) {
    console.log(`✓ Target met: ${summary.qualified} ≥ ${args.target}. Open the dashboard ("/") to see them.`);
  } else {
    console.log(
      `~ Found ${summary.qualified} of ${args.target}. They are on the feed; to find more, ` +
        `raise --limit, add ICP categories, or run another --metro.`,
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Probe failed:", err);
  process.exit(1);
});
