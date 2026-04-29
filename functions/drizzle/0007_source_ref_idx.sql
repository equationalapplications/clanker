CREATE INDEX "wiki_entries_source_ref_idx" ON "wiki_entries" USING btree ("character_id","source_ref") WHERE "source_ref" IS NOT NULL;
