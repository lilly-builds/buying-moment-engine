import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./columns";
import { practices } from "./entities";

/**
 * Outreach send records — the ONE shared "Sent" state for a practice's outreach.
 *
 * The app is a single shared workspace (no per-user data isolation — see
 * `src/discovery/tenants.ts`), so every signed-in AE looks at the same leads and the
 * same Send buttons. This table is the concurrency guard that makes that safe: a row
 * is CLAIMED atomically — `INSERT ... ON CONFLICT (practice_id) DO NOTHING` — BEFORE
 * any HubSpot call, so of two AEs clicking Send on the same lead at the same instant
 * exactly ONE proceeds and the other is turned away cleanly, never a duplicate
 * enrollment or an overwritten draft.
 *
 * Lifecycle (see `db/outreach.ts`): `status` starts `sending` at claim time and flips
 * to `sent` once HubSpot confirms the enrollment; a send that FAILS deletes the row
 * (releases the claim) so the lead can be retried and is never left falsely "sent".
 * `sent_by` is the allowlisted session email — the audit trail + the "Sent by X" label.
 *
 * One row per practice (the send enrolls the practice's one decision-maker contact, so
 * "sent" is per-practice), hence the unique `practice_id` — the ON CONFLICT target.
 */
export const outreachSendStatus = pgEnum("outreach_send_status", [
  "sending",
  "sent",
]);

export const outreachSends = pgTable("outreach_sends", {
  id: uuid("id").primaryKey().defaultRandom(),
  practiceId: uuid("practice_id")
    .notNull()
    .unique()
    .references(() => practices.id),
  status: outreachSendStatus("status").notNull().default("sending"),
  // WHO clicked Send — the allowlisted session email (audit + the "Sent by X" label).
  sentBy: text("sent_by").notNull(),
  // Set when status flips to `sent`; null while still `sending`.
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS();
