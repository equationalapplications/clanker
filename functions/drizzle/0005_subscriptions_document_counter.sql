ALTER TABLE "subscriptions" ADD COLUMN "documents_ingested_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "documents_ingested_date" text;