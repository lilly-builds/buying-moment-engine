/**
 * The landing-experiment readout. Run this any time to see how the three pages
 * are converting and which marketing channel is driving signups.
 *
 *   npx tsx scripts/lp-report.ts
 *
 * Reads the two public marketing tables (waitlist_signups, marketing_events) and
 * prints: views, signups, and conversion rate per variant, plus signups by
 * traffic source. Read-only.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { getDb } from "@/db/client";
import { signupsBySource, variantFunnel, type VariantFunnelRow } from "@/db/marketing";

const NAMES: Record<string, string> = {
  saas: "LP1 /for/saas — B2B software teams (signal-led, premium)",
  outbound: "LP2 /for/outbound — any outbound team (outcome-led, mid)",
  founders: "LP3 /for/founders — founders + lean teams (AI-wedge, low)",
};

function pct(signups: number, views: number): string {
  if (views === 0) return "  n/a";
  return `${((signups / views) * 100).toFixed(1)}%`.padStart(6);
}

async function main() {
  const db = getDb();
  const funnel = await variantFunnel(db);
  const bySource = await signupsBySource(db);

  console.log("\n=== LANDING EXPERIMENT READOUT ===\n");
  if (funnel.length === 0) {
    console.log("No traffic recorded yet. (Views appear once the pages get visits.)\n");
  } else {
    const all: VariantFunnelRow = { variant: "TOTAL", views: 0, signups: 0 };
    console.log("variant".padEnd(10), "views".padStart(8), "signups".padStart(9), "conv".padStart(8));
    console.log("-".repeat(40));
    for (const r of funnel) {
      all.views += r.views;
      all.signups += r.signups;
      console.log(
        r.variant.padEnd(10),
        String(r.views).padStart(8),
        String(r.signups).padStart(9),
        pct(r.signups, r.views).padStart(8),
      );
    }
    console.log("-".repeat(40));
    console.log(
      all.variant.padEnd(10),
      String(all.views).padStart(8),
      String(all.signups).padStart(9),
      pct(all.signups, all.views).padStart(8),
    );
    console.log("\nlegend:");
    for (const r of funnel) console.log("  ", NAMES[r.variant] ?? r.variant);
  }

  console.log("\n--- signups by traffic source ---");
  if (bySource.length === 0) {
    console.log("  none yet");
  } else {
    for (const s of bySource.sort((a, b) => b.signups - a.signups)) {
      console.log("  ", String(s.signups).padStart(4), s.source);
    }
  }
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("report failed:", e.message);
    process.exit(1);
  });
