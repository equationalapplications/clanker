ALTER TABLE "wiki_entries" ADD COLUMN "source_hash" text;--> statement-breakpoint
ALTER TABLE "wiki_entries" ADD COLUMN "source_ref" text;--> statement-breakpoint
ALTER TABLE "wiki_entries" DROP CONSTRAINT IF EXISTS "wiki_entries_source_type_check";--> statement-breakpoint
ALTER TABLE "wiki_entries" ADD CONSTRAINT "wiki_entries_source_type_check" CHECK ("wiki_entries"."source_type" IN ('user_stated', 'agent_inferred', 'user_confirmed', 'user_document'));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wiki_entries_source_hash_idx" ON "wiki_entries" USING btree ("character_id","source_hash");
