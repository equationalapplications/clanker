CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "llm_wiki_entries"
  ADD COLUMN "embedding" vector(768);

CREATE INDEX "llm_wiki_entries_embedding_idx"
  ON "llm_wiki_entries" USING hnsw ("embedding" vector_cosine_ops);