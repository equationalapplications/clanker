ALTER TABLE "llm_wiki_entries" ADD COLUMN "source_type" text DEFAULT 'agent_inferred' NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_wiki_entries" ADD COLUMN "last_accessed_at" bigint;--> statement-breakpoint
ALTER TABLE "llm_wiki_entries" ADD COLUMN "access_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_wiki_entries" ADD COLUMN "deleted_at" bigint;--> statement-breakpoint
ALTER TABLE "llm_wiki_tasks" ADD COLUMN "deleted_at" bigint;