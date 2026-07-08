CREATE TYPE "public"."enrichment_provider" AS ENUM('claude_research', 'pdl');--> statement-breakpoint
CREATE TABLE "practice_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"field" text NOT NULL,
	"value" text NOT NULL,
	"evidence_id" uuid NOT NULL,
	"provider" "enrichment_provider" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_facts_practice_field_uq" UNIQUE("practice_id","field")
);
--> statement-breakpoint
ALTER TABLE "practice_facts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "evidence" ALTER COLUMN "detected_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "signals" ALTER COLUMN "detected_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "email_provider" "enrichment_provider";--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "linkedin_provider" "enrichment_provider";--> statement-breakpoint
ALTER TABLE "practice_facts" ADD CONSTRAINT "practice_facts_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_facts" ADD CONSTRAINT "practice_facts_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practices" DROP COLUMN "ehr";--> statement-breakpoint
ALTER TABLE "practices" DROP COLUMN "locations_count";