/**
 * Surgically apply the marketing migration (0009_round_purifiers.sql) — the two
 * NEW, additive tables for the landing experiments (waitlist_signups,
 * marketing_events). We do NOT use `drizzle-kit migrate` here on purpose: the
 * live DB is one migration ahead of origin/main (pre-existing drift), so the
 * drizzle journal and repo disagree and `migrate` would be unreliable. This
 * script instead runs ONLY the CREATE TABLE / CREATE INDEX / ENABLE RLS
 * statements for the two new tables, and only when they are missing. It touches
 * no existing table.
 *
 *   npx tsx scripts/apply-marketing-migration.ts          # apply if missing
 *   npx tsx scripts/apply-marketing-migration.ts --verify # apply + insert/read/delete a test row
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const MIGRATION = "db/migrations/0009_round_purifiers.sql";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const doVerify = process.argv.includes("--verify");
  const sql = postgres(url, { prepare: false });

  try {
    const before = await sql`SELECT to_regclass('public.waitlist_signups') AS w, to_regclass('public.marketing_events') AS m`;
    const haveWaitlist = before[0].w !== null;
    const haveEvents = before[0].m !== null;

    if (haveWaitlist && haveEvents) {
      console.log("Both tables already exist — nothing to apply.");
    } else {
      const raw = readFileSync(join(process.cwd(), MIGRATION), "utf8");
      const statements = raw
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean);
      console.log(`Applying ${statements.length} statements from ${MIGRATION} ...`);
      for (const stmt of statements) {
        // Guard: skip a CREATE TABLE whose table already exists (idempotent re-run).
        const createMatch = stmt.match(/^CREATE TABLE "(\w+)"/i);
        if (createMatch) {
          const t = createMatch[1];
          const exists = await sql`SELECT to_regclass(${"public." + t}) AS t`;
          if (exists[0].t !== null) {
            console.log(`  skip (exists): CREATE TABLE ${t}`);
            continue;
          }
        }
        await sql.unsafe(stmt);
        console.log(`  ok: ${stmt.slice(0, 60).replace(/\s+/g, " ")}...`);
      }
    }

    const after = await sql`SELECT to_regclass('public.waitlist_signups') AS w, to_regclass('public.marketing_events') AS m`;
    console.log("waitlist_signups exists:", after[0].w !== null);
    console.log("marketing_events exists:", after[0].m !== null);

    if (doVerify) {
      const marker = "verify-delete-me@example.invalid";
      console.log("\n[verify] inserting a test signup + event, reading back, then deleting...");
      const [ins] = await sql`
        INSERT INTO waitlist_signups (email, variant, what_you_sell, utm_source)
        VALUES (${marker}, ${"saas"}, ${"synthetic verification row"}, ${"verify-script"})
        RETURNING id`;
      const [insEv] = await sql`
        INSERT INTO marketing_events (event_type, variant, path, session_id, utm_source)
        VALUES (${"view"}, ${"saas"}, ${"/for/saas"}, ${"verify-session"}, ${"verify-script"})
        RETURNING id`;
      const readBack = await sql`SELECT id, email, variant, what_you_sell FROM waitlist_signups WHERE id = ${ins.id}`;
      console.log("  read back signup:", JSON.stringify(readBack[0]));
      const evBack = await sql`SELECT id, event_type, variant FROM marketing_events WHERE id = ${insEv.id}`;
      console.log("  read back event:", JSON.stringify(evBack[0]));
      const del1 = await sql`DELETE FROM waitlist_signups WHERE id = ${ins.id}`;
      const del2 = await sql`DELETE FROM marketing_events WHERE id = ${insEv.id}`;
      console.log(`  cleaned up test rows (signups: ${del1.count}, events: ${del2.count})`);
      const remain = await sql`SELECT count(*)::int AS n FROM waitlist_signups WHERE email = ${marker}`;
      console.log(`  test rows remaining (must be 0): ${remain[0].n}`);
    }
    console.log("\nDone.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error("apply failed:", e.message);
  process.exit(1);
});
