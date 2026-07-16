import { sql } from "drizzle-orm";
import {
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt } from "./columns";
import { practices } from "./entities";

/**
 * ROI domain — the event log that drives the scoreboard (R12) and the cost meter
 * ledger (R19) that turns cost-per-brief / per-lead / per-meeting into MEASURED
 * numbers. Business data only — no patient-shaped fields anywhere (D9).
 */

export const roiEventType = pgEnum("roi_event_type", [
  "brief_generated",
  "lead_pushed",
  "meeting_booked",
  "deal_won",
  "feedback",
  "sequence_edited",
  "time_saved_estimate",
]);

export const engineRunPhase = pgEnum("engine_run_phase", [
  "all",
  "sources",
  "downstream",
]);

export const engineRunStatus = pgEnum("engine_run_status", [
  "running",
  "completed",
  "failed",
]);

export const roiEvents = pgTable("roi_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventType: roiEventType("event_type").notNull(),
  practiceId: uuid("practice_id").references(() => practices.id),
  // First-class vertical tag so metrics slice per-vertical instantly (R17).
  vertical: text("vertical"),
  payload: jsonb("payload"),
  createdAt: createdAt(),
}).enableRLS();

/**
 * cost_events (R19) — ONE row per metered paid call, written at the call site by
 * `src/roi/cost-meter.ts`. This is what makes CAC a measured number.
 */
export const costEvents = pgTable("cost_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  operation: text("operation").notNull(),
  pipelineStep: text("pipeline_step").notNull(),
  practiceId: uuid("practice_id").references(() => practices.id),
  units: numeric("units").notNull(),
  unitCostUsd: numeric("unit_cost_usd").notNull(),
  costUsd: numeric("cost_usd").notNull(),
  meta: jsonb("meta"),
  createdAt: createdAt(),
}).enableRLS();

/**
 * Durable receipts for scheduled engine invocations. A row is inserted before provider setup,
 * then completed with the returned summary. A `running` row is only stale after the function's
 * maximum duration plus a margin; a fresh `running` row is a healthy invocation still in flight.
 */
export const engineRuns = pgTable("engine_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  phase: engineRunPhase("phase").notNull(),
  status: engineRunStatus("status").notNull().default("running"),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  summary: jsonb("summary"),
  error: text("error"),
}, (t) => [
  uniqueIndex("engine_runs_one_running_per_phase")
    .on(t.phase)
    .where(sql`${t.status} = 'running'`),
]).enableRLS();
