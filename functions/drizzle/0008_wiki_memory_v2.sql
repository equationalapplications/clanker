CREATE TABLE "llm_wiki_entries" (
	"id" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" text DEFAULT 'inferred' NOT NULL,
	"source_ref" text,
	"source_hash" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"deleted_at" bigint,
	CONSTRAINT "llm_wiki_entries_id_user_id_pk" PRIMARY KEY("id","user_id")
);
--> statement-breakpoint
CREATE TABLE "llm_wiki_events" (
	"id" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"summary" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "llm_wiki_events_id_user_id_pk" PRIMARY KEY("id","user_id")
);
--> statement-breakpoint
CREATE TABLE "llm_wiki_tasks" (
	"id" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"resolved_at" bigint,
	"deleted_at" bigint,
	CONSTRAINT "llm_wiki_tasks_id_user_id_pk" PRIMARY KEY("id","user_id")
);
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "save_to_cloud" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Backfill: all characters already in Cloud SQL are cloud-linked by definition.
UPDATE "characters" SET "save_to_cloud" = true;--> statement-breakpoint
ALTER TABLE "llm_wiki_entries" ADD CONSTRAINT "llm_wiki_entries_entity_id_characters_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_wiki_entries" ADD CONSTRAINT "llm_wiki_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_wiki_events" ADD CONSTRAINT "llm_wiki_events_entity_id_characters_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_wiki_events" ADD CONSTRAINT "llm_wiki_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_wiki_tasks" ADD CONSTRAINT "llm_wiki_tasks_entity_id_characters_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_wiki_tasks" ADD CONSTRAINT "llm_wiki_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "llm_wiki_entries_entity_user_idx" ON "llm_wiki_entries" USING btree ("entity_id","user_id");--> statement-breakpoint
CREATE INDEX "llm_wiki_entries_updated_at_idx" ON "llm_wiki_entries" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "llm_wiki_events_entity_created_idx" ON "llm_wiki_events" USING btree ("entity_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "llm_wiki_tasks_entity_status_idx" ON "llm_wiki_tasks" USING btree ("entity_id","user_id","status");