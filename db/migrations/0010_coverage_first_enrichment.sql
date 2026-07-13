ALTER TYPE "enrichment_provider" ADD VALUE IF NOT EXISTS 'prospeo';--> statement-breakpoint
ALTER TYPE "enrichment_provider" ADD VALUE IF NOT EXISTS 'fullenrich';--> statement-breakpoint
ALTER TYPE "enrichment_provider" ADD VALUE IF NOT EXISTS 'bettercontact';--> statement-breakpoint
ALTER TYPE "enrichment_provider" ADD VALUE IF NOT EXISTS 'website_scrape';--> statement-breakpoint
ALTER TYPE "enrichment_provider" ADD VALUE IF NOT EXISTS 'org_website';--> statement-breakpoint
CREATE TYPE "buyer_tier" AS ENUM ('A', 'B', 'C', 'D', 'E', 'X', 'none');--> statement-breakpoint
CREATE TYPE "selected_contact_classification" AS ENUM ('best_buyer', 'reachable_fallback', 'weak_unrelated', 'none');--> statement-breakpoint
CREATE TYPE "email_quality" AS ENUM ('safe_work', 'weak_work', 'personal', 'org_inbox', 'none');--> statement-breakpoint
ALTER TABLE "practices" ADD COLUMN "company_linkedin_url" text;--> statement-breakpoint
ALTER TABLE "practices" ADD COLUMN "company_facebook_url" text;--> statement-breakpoint
ALTER TABLE "practices" ADD COLUMN "company_instagram_url" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "email_quality" "email_quality";--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "person_provider" "enrichment_provider";--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "buyer_tier" "buyer_tier";--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "selected_contact_classification" "selected_contact_classification";--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "fallback_reason" text;
