import {
  integer,
  jsonb,
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
 * Brief domain — the persisted two-tier brief and its editable 3-touch sequence.
 *
 * IMPORTANT (KTD): time-sensitive fields — freshness badge, signal_count, and the
 * fired-signal list — are NOT stored on the brief. They compute at render time
 * from the `signals` table, so a stored brief can never claim "3 signals firing"
 * after one has expired past its freshness window.
 */

export const sequenceStatus = pgEnum("sequence_status", ["draft"]);

export const briefs = pgTable("briefs", {
  id: uuid("id").primaryKey().defaultRandom(),
  practiceId: uuid("practice_id")
    .notNull()
    .unique()
    .references(() => practices.id),
  // Deterministic fields assembled in code, each carrying its evidence ids (R5).
  factual: jsonb("factual"),
  // LLM-authored voice fields (opener, sequence, personalization, questions).
  voice: jsonb("voice"),
  schemaVersion: integer("schema_version").notNull().default(1),
  generatedAt: timestamp("generated_at", { withTimezone: true }),
  regeneratedAt: timestamp("regenerated_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS();

export const sequences = pgTable(
  "sequences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    briefId: uuid("brief_id")
      .notNull()
      .references(() => briefs.id),
    touchNumber: integer("touch_number").notNull(), // 1..3
    channel: text("channel"),
    body: text("body"),
    cta: text("cta"),
    // drafts only — nothing sends (R7).
    status: sequenceStatus("status").notNull().default("draft"),
    savedAt: timestamp("saved_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("sequences_brief_touch_uq").on(t.briefId, t.touchNumber)],
).enableRLS();
