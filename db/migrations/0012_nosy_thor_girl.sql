CREATE TYPE "public"."activity_event_type" AS ENUM('sign_in', 'page_view');--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_type" "activity_event_type" NOT NULL,
	"email" text NOT NULL,
	"org_domain" text NOT NULL,
	"path" text,
	"user_id" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE INDEX "activity_events_occurred_at_idx" ON "activity_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "activity_events_org_domain_idx" ON "activity_events" USING btree ("org_domain");--> statement-breakpoint
ALTER TABLE "activity_events" ENABLE ROW LEVEL SECURITY;