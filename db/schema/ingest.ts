import { pgEnum, pgTable, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Ingest domain — the RAW layer (R17: raw signals kept separate from normalized
 * entities and derived scores). Rows land here first with a validation verdict;
 * only valid rows are promoted to the normalized `entities` tables. Malformed
 * rows are retained here as `rejected` for audit and never flow downstream.
 */

export const validationStatus = pgEnum("validation_status", [
  "pending",
  "valid",
  "rejected",
]);

export const rawSignals = pgTable("raw_signals", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Idempotency key — de-dupes at ingest via ON CONFLICT DO NOTHING (R17).
  dedupeHash: text("dedupe_hash").notNull().unique(),
  detectorKind: text("detector_kind").notNull(),
  payload: jsonb("payload").notNull(),
  sourceUrl: text("source_url"),
  practiceHint: text("practice_hint"),
  detectedAt: timestamp("detected_at", { withTimezone: true }),
  ingestedAt: timestamp("ingested_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  validationStatus: validationStatus("validation_status")
    .notNull()
    .default("pending"),
  rejectionReason: text("rejection_reason"),
});
