CREATE TABLE "signal_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"kind" "signal_kind" NOT NULL,
	"status" text NOT NULL,
	"provider" text NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"cooldown_expires_at" timestamp with time zone NOT NULL,
	"cost_usd" numeric,
	"matched_practice_name" text,
	"match_confidence" numeric,
	"evidence_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signal_checks_practice_kind_provider_uq" UNIQUE("practice_id","kind","provider")
);
--> statement-breakpoint
ALTER TABLE "signal_checks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "signal_checks" ADD CONSTRAINT "signal_checks_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_checks" ADD CONSTRAINT "signal_checks_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE no action ON UPDATE no action;