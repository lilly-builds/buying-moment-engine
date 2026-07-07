import {
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./columns";
import { practices } from "./entities";

/**
 * CRM domain — AE lead-quality feedback (R13) and the CRM link/track records (R8).
 */

export const feedbackThumb = pgEnum("feedback_thumb", ["up", "down"]);

export const feedbackReason = pgEnum("feedback_reason", [
  "too_small",
  "wrong_specialty",
  "already_customer",
  "bad_timing",
]);

export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    practiceId: uuid("practice_id")
      .notNull()
      .references(() => practices.id),
    aeEmail: text("ae_email").notNull(),
    thumb: feedbackThumb("thumb").notNull(),
    reason: feedbackReason("reason"),
    freeText: text("free_text"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // A re-vote UPDATES the existing row, never duplicates (R13).
  (t) => [unique("feedback_practice_ae_uq").on(t.practiceId, t.aeEmail)],
).enableRLS();

export const crmLinks = pgTable(
  "crm_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    practiceId: uuid("practice_id")
      .notNull()
      .references(() => practices.id),
    provider: text("provider").notNull().default("hubspot"),
    companyId: text("company_id"),
    contactId: text("contact_id"),
    dealId: text("deal_id"),
    stage: text("stage"),
    stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }),
    cycleTimeDays: numeric("cycle_time_days"),
    // First-class lead-quality tag (R17).
    leadQuality: text("lead_quality"),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("crm_links_practice_provider_uq").on(t.practiceId, t.provider)],
).enableRLS();
