/**
 * Read-only recon before applying the marketing migration (0009). Reports:
 *  - whether the two new tables already exist
 *  - what drizzle's migration journal in the DB shows as applied
 * so we can pick the safest apply path. Makes NO writes.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { prepare: false });
  try {
    const waitlist = await sql`SELECT to_regclass('public.waitlist_signups') AS t`;
    const events = await sql`SELECT to_regclass('public.marketing_events') AS t`;
    console.log("waitlist_signups exists:", waitlist[0].t !== null);
    console.log("marketing_events exists:", events[0].t !== null);

    // drizzle journal — table lives in the "drizzle" schema by default.
    const journalExists = await sql`SELECT to_regclass('drizzle.__drizzle_migrations') AS t`;
    if (journalExists[0].t === null) {
      console.log("drizzle journal table: NOT FOUND (migrations may be applied out-of-band)");
    } else {
      const rows = await sql`
        SELECT hash, created_at
        FROM drizzle.__drizzle_migrations
        ORDER BY created_at DESC
        LIMIT 3`;
      console.log("drizzle journal rows (latest 3):", rows.length);
      for (const r of rows) console.log("  -", r.created_at, String(r.hash).slice(0, 16));
      const countRows = await sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`;
      console.log("drizzle journal total applied:", countRows[0].n);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error("recon failed:", e.message);
  process.exit(1);
});
