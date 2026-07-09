/**
 * Run the idempotent demo seed against the real database.
 *
 *   pnpm db:seed            # or: npx tsx scripts/seed-demo.ts
 *
 * Reads DATABASE_URL from `.env.local`. Non-destructive and idempotent (see
 * `db/seed-demo.ts`): it only adds clearly-demo practices, never touches the real
 * ones, and a second run writes nothing. Safe to run repeatedly.
 */
import { config } from "dotenv";
import { getDb } from "@/db/client";
import { seedDemo } from "@/db/seed-demo";

config({ path: ".env.local" });

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set (checked .env.local). Aborting — nothing written.");
    process.exit(1);
  }
  await seedDemo(getDb(), new Date());
  console.log("✓ Demo seed complete (idempotent — safe to re-run).");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
