CREATE TABLE "marketing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"variant" text NOT NULL,
	"path" text,
	"session_id" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marketing_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "waitlist_signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"variant" text NOT NULL,
	"what_you_sell" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"referrer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "waitlist_signups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "marketing_events_variant_idx" ON "marketing_events" USING btree ("variant");--> statement-breakpoint
CREATE INDEX "marketing_events_type_idx" ON "marketing_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "waitlist_signups_variant_idx" ON "waitlist_signups" USING btree ("variant");