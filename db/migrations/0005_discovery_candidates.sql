CREATE TABLE "discovery_candidates" (
	"place_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"geo_key" text NOT NULL,
	"vertical" text,
	"rating" numeric,
	"review_count" integer,
	"last_pulled_at" timestamp with time zone,
	"last_verdict" text NOT NULL,
	"qualified_kind" text,
	"detected_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discovery_candidates" ENABLE ROW LEVEL SECURITY;