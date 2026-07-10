/**
 * Backfill the per-connection SEND config on the existing dev HubSpot connection
 * (per-connection-send-config). Before this change the sequence/sender lived in env;
 * the dev connection predates the new columns, so set them once so local send keeps
 * working. Idempotent + non-destructive: it only fills a field that is still empty,
 * and never overwrites a value already set (so a real re-connect's auto-captured
 * sender or a pasted sequence id is safe).
 *
 *   npx tsx scripts/backfill-send-config.ts
 *
 * The values are the dev portal's real sequence + Lilly's connected inbox/user
 * (documented in eliseai/NEXT-per-connection-send-config.md STEP 4).
 */
import { config } from "dotenv";
import { getActiveConnection, setConnectionSendConfig } from "@/db/crm";
import { getDb } from "@/db/client";

config({ path: ".env.local" });

const DEV_SEND_CONFIG = {
  sequenceId: "712515259",
  senderEmail: "hellolillyfield@gmail.com",
  senderUserId: "95142122",
} as const;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set (checked .env.local). Aborting — nothing written.");
    process.exit(1);
  }
  const db = getDb();
  const active = await getActiveConnection(db);
  if (!active.ok) {
    console.error(
      `No single active HubSpot connection to backfill (${active.reason}). Connect HubSpot first.`,
    );
    process.exit(1);
  }

  const conn = active.connection;
  // Only fill what's still empty — never clobber a real value.
  const patch: { sequenceId?: string; senderEmail?: string; senderUserId?: string } = {};
  if (!conn.sequenceId) patch.sequenceId = DEV_SEND_CONFIG.sequenceId;
  if (!conn.senderEmail) patch.senderEmail = DEV_SEND_CONFIG.senderEmail;
  if (!conn.senderUserId) patch.senderUserId = DEV_SEND_CONFIG.senderUserId;

  if (Object.keys(patch).length === 0) {
    console.log(
      `✓ Send config already set on portal ${conn.portalId} (sequence ${conn.sequenceId}). Nothing to do.`,
    );
    process.exit(0);
  }

  const { updated } = await setConnectionSendConfig(db, {
    portalId: conn.portalId,
    ...patch,
  });
  if (!updated) {
    console.error("Update matched no row — the connection vanished mid-run. Nothing written.");
    process.exit(1);
  }
  console.log(
    `✓ Backfilled ${Object.keys(patch).join(", ")} on portal ${conn.portalId}. Local send is ready.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Send-config backfill failed:", err);
  process.exit(1);
});
