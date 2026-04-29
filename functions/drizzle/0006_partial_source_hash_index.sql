DROP INDEX IF EXISTS "wiki_entries_source_hash_idx";--> statement-breakpoint
CREATE INDEX "wiki_entries_source_hash_idx" ON "wiki_entries" USING btree ("character_id","source_hash") WHERE "source_hash" IS NOT NULL;
