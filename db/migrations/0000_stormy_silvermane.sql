CREATE TYPE "public"."validation_status" AS ENUM('pending', 'valid', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."enrichment_status" AS ENUM('pending', 'enriched', 'failed');--> statement-breakpoint
CREATE TYPE "public"."signal_kind" AS ENUM('staffing_spike', 'phone_complaints', 'growth_events', 'regulation');--> statement-breakpoint
CREATE TYPE "public"."vertical" AS ENUM('dermatology', 'womens_health', 'ophthalmology', 'orthopedics', 'unclassified');--> statement-breakpoint
CREATE TYPE "public"."sequence_status" AS ENUM('draft');--> statement-breakpoint
CREATE TYPE "public"."feedback_reason" AS ENUM('too_small', 'wrong_specialty', 'already_customer', 'bad_timing');--> statement-breakpoint
CREATE TYPE "public"."feedback_thumb" AS ENUM('up', 'down');--> statement-breakpoint
CREATE TYPE "public"."roi_event_type" AS ENUM('brief_generated', 'lead_pushed', 'meeting_booked', 'deal_won', 'feedback', 'sequence_edited', 'time_saved_estimate');--> statement-breakpoint
CREATE TABLE "raw_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedupe_hash" text NOT NULL,
	"detector_kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"source_url" text,
	"practice_hint" text,
	"detected_at" timestamp with time zone,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"validation_status" "validation_status" DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	CONSTRAINT "raw_signals_dedupe_hash_unique" UNIQUE("dedupe_hash")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"name" text,
	"role" text NOT NULL,
	"linkedin_url" text,
	"best_channel" text,
	"personalization_snippet" text,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_url" text NOT NULL,
	"snippet" text,
	"confidence" numeric,
	"detected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "practices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"city" text,
	"state" text,
	"geo_key" text NOT NULL,
	"vertical" "vertical" DEFAULT 'unclassified' NOT NULL,
	"enrichment_status" "enrichment_status" DEFAULT 'pending' NOT NULL,
	"ehr" text,
	"locations_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practices_normalized_geo_uq" UNIQUE("normalized_name","geo_key")
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"kind" "signal_kind" NOT NULL,
	"evidence_id" uuid NOT NULL,
	"confidence" numeric,
	"detected_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"signal_source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signals_practice_kind_evidence_uq" UNIQUE("practice_id","kind","evidence_id")
);
--> statement-breakpoint
CREATE TABLE "briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"factual" jsonb,
	"voice" jsonb,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"generated_at" timestamp with time zone,
	"regenerated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "briefs_practice_id_unique" UNIQUE("practice_id")
);
--> statement-breakpoint
CREATE TABLE "sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brief_id" uuid NOT NULL,
	"touch_number" integer NOT NULL,
	"channel" text,
	"body" text,
	"cta" text,
	"status" "sequence_status" DEFAULT 'draft' NOT NULL,
	"saved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sequences_brief_touch_uq" UNIQUE("brief_id","touch_number")
);
--> statement-breakpoint
CREATE TABLE "crm_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"provider" text DEFAULT 'hubspot' NOT NULL,
	"company_id" text,
	"contact_id" text,
	"deal_id" text,
	"stage" text,
	"stage_changed_at" timestamp with time zone,
	"cycle_time_days" numeric,
	"lead_quality" text,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_links_practice_provider_uq" UNIQUE("practice_id","provider")
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"ae_email" text NOT NULL,
	"thumb" "feedback_thumb" NOT NULL,
	"reason" "feedback_reason",
	"free_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_practice_ae_uq" UNIQUE("practice_id","ae_email")
);
--> statement-breakpoint
CREATE TABLE "cost_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"operation" text NOT NULL,
	"pipeline_step" text NOT NULL,
	"practice_id" uuid,
	"units" numeric NOT NULL,
	"unit_cost_usd" numeric NOT NULL,
	"cost_usd" numeric NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roi_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" "roi_event_type" NOT NULL,
	"practice_id" uuid,
	"vertical" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_links" ADD CONSTRAINT "crm_links_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roi_events" ADD CONSTRAINT "roi_events_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;