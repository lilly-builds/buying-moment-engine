CREATE TYPE "public"."outreach_send_status" AS ENUM('sending', 'sent');--> statement-breakpoint
CREATE TABLE "outreach_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"status" "outreach_send_status" DEFAULT 'sending' NOT NULL,
	"sent_by" text NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outreach_sends_practice_id_unique" UNIQUE("practice_id")
);
--> statement-breakpoint
ALTER TABLE "outreach_sends" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "outreach_sends" ADD CONSTRAINT "outreach_sends_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;
