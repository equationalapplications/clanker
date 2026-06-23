CREATE TABLE "llm_wiki_edges" (
  "id" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "source_id" text NOT NULL,
  "target_id" text NOT NULL,
  "edge_type" text NOT NULL,
  "created_at" bigint NOT NULL,
  CONSTRAINT "llm_wiki_edges_id_user_id_pk" PRIMARY KEY ("id", "user_id")
);

CREATE TABLE "llm_wiki_ontology" (
  "entity_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "mode" text DEFAULT 'off' NOT NULL,
  "manifest" jsonb,
  "updated_at" bigint NOT NULL,
  CONSTRAINT "llm_wiki_ontology_entity_id_user_id_pk" PRIMARY KEY ("entity_id", "user_id")
);

ALTER TABLE "llm_wiki_edges" ADD CONSTRAINT "llm_wiki_edges_entity_id_characters_id_fk"
  FOREIGN KEY ("entity_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "llm_wiki_edges" ADD CONSTRAINT "llm_wiki_edges_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "llm_wiki_ontology" ADD CONSTRAINT "llm_wiki_ontology_entity_id_characters_id_fk"
  FOREIGN KEY ("entity_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "llm_wiki_ontology" ADD CONSTRAINT "llm_wiki_ontology_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "llm_wiki_ontology" ADD CONSTRAINT "llm_wiki_ontology_mode_check"
  CHECK ("mode" IN ('strict', 'emergent', 'off'));

CREATE INDEX "llm_wiki_edges_entity_user_idx" ON "llm_wiki_edges" ("entity_id", "user_id");

CREATE INDEX "llm_wiki_edges_source_idx" ON "llm_wiki_edges" ("source_id", "user_id");

CREATE INDEX "llm_wiki_edges_target_idx" ON "llm_wiki_edges" ("target_id", "user_id");
