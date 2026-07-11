/**
 * Seed the EliseAI default workspace (slug "eliseai") against the real database.
 *
 *   npx tsx scripts/seed-default-workspace.ts
 *
 * Reads DATABASE_URL from `.env.local`. Idempotent: ON CONFLICT DO NOTHING on
 * the unique `slug`, so re-running never duplicates a row or clobbers one a
 * human has since edited in the Customization Studio (D13 / R17).
 *
 * This makes the default workspace SELECTABLE by slug
 * (`setActiveWorkspace("eliseai")`) — it does NOT change what happens with no
 * cookie set at all; `getActiveWorkspace()`'s synthetic default still covers
 * that case on its own, so this seed is additive convenience, not a
 * dependency of the resolver.
 */
import { config } from "dotenv";
import { getDb } from "@/db/client";
import { workspaces } from "@/db/schema";
import { ELISEAI_DEFAULT } from "@/src/workspace/default";

config({ path: ".env.local" });

const SLUG = "eliseai";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL is not set (checked .env.local). Aborting — nothing written.",
    );
    process.exit(1);
  }

  const db = getDb();
  const inserted = await db
    .insert(workspaces)
    .values({
      slug: SLUG,
      name: ELISEAI_DEFAULT.brand.companyName,
      config: ELISEAI_DEFAULT,
    })
    .onConflictDoNothing({ target: workspaces.slug })
    .returning({ id: workspaces.id });

  if (inserted.length > 0) {
    console.log(
      `✓ Default workspace seeded (slug "${SLUG}", id ${inserted[0].id}).`,
    );
  } else {
    console.log(
      `✓ Default workspace already present (slug "${SLUG}") — no change (idempotent).`,
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Default workspace seed failed:", err);
  process.exit(1);
});
