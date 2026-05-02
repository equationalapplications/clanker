ALTER TABLE "llm_wiki_entries" ADD COLUMN "source_type" text DEFAULT 'agent_inferred' NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_wiki_entries" ADD CONSTRAINT "llm_wiki_entries_source_type_check" CHECK ("source_type" IN ('user_stated', 'agent_inferred', 'user_confirmed', 'user_document'));--> statement-breakpoint
ALTER TABLE "llm_wiki_entries" ADD COLUMN "last_accessed_at" bigint;--> statement-breakpoint
ALTER TABLE "llm_wiki_entries" ADD COLUMN "access_count" integer DEFAULT 0 NOT NULL;