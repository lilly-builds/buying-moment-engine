/**
 * Seed the D9 SANDBOX test lead (U11) against the real database.
 *
 *   pnpm db:seed:sandbox      # or: npx tsx scripts/seed-sandbox.ts
 *
 * Adds ONE demo/sandbox practice with a full brief whose contact address is
 * hellolillyfield@gmail.com — the fixture the live email-send path is proven against.
 * Idempotent + non-destructive (see `db/seed-sandbox.ts`); safe to re-run. Prints the
 * practice id so you can open /practice/<id> directly.
 */
import { config } from "dotenv";
import { getDb } from "@/db/client";
import { seedSandboxLead } from "@/db/seed-sandbox";

config({ path: ".env.local" });

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set (checked .env.local). Aborting — nothing written.");
    process.exit(1);
  }
  const practiceId = await seedSandboxLead(getDb(), new Date());
  console.log(`✓ Sandbox lead seeded (idempotent). Open: /practice/${practiceId}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Sandbox seed failed:", err);
  process.exit(1);
});
