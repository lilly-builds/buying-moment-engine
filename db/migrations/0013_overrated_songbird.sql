CREATE TYPE "public"."engine_run_phase" AS ENUM('all', 'sources', 'downstream');--> statement-breakpoint
CREATE TYPE "public"."engine_run_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "engine_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phase" "engine_run_phase" NOT NULL,
	"status" "engine_run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"summary" jsonb,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "engine_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "practices" ADD COLUMN "last_brief_attempt_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "engine_runs_one_running_per_phase" ON "engine_runs" USING btree ("phase") WHERE "engine_runs"."status" = 'running';