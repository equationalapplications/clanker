CREATE TABLE IF NOT EXISTS "wiki_entries" (
  "id" text PRIMARY KEY NOT NULL,
  "character_id" uuid NOT NULL REFERENCES "characters"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "confidence" text NOT NULL DEFAULT 'inferred',
  "source_type" text NOT NULL DEFAULT 'agent_inferred',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_accessed_at" timestamp with time zone,
  "access_count" integer NOT NULL DEFAULT 0,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "wiki_entries_confidence_check" CHECK ("confidence" IN ('certain', 'inferred', 'tentative')),
  CONSTRAINT "wiki_entries_source_type_check" CHECK ("source_type" IN ('user_stated', 'agent_inferred', 'user_confirmed'))
);

CREATE INDEX IF NOT EXISTS "wiki_entries_character_user_idx" ON "wiki_entries" ("character_id", "user_id");
CREATE INDEX IF NOT EXISTS "wiki_entries_character_deleted_idx" ON "wiki_entries" ("character_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "wiki_entries_updated_at_idx" ON "wiki_entries" ("updated_at" DESC);
CREATE INDEX IF NOT EXISTS "wiki_entries_search_gin_idx"
  ON "wiki_entries"
  USING GIN (to_tsvector('english', coalesce("title", '') || ' ' || coalesce("body", '') || ' ' || coalesce("tags"::text, '')));

CREATE TABLE IF NOT EXISTS "agent_tasks" (
  "id" text PRIMARY KEY NOT NULL,
  "character_id" uuid NOT NULL REFERENCES "characters"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "description" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "priority" integer NOT NULL DEFAULT 0,
  "due_context" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "resolved_at" timestamp with time zone,
  "resolution_note" text,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "agent_tasks_status_check" CHECK ("status" IN ('pending', 'in_progress', 'done', 'abandoned'))
);

CREATE INDEX IF NOT EXISTS "agent_tasks_character_status_idx" ON "agent_tasks" ("character_id", "user_id", "status");
CREATE INDEX IF NOT EXISTS "agent_tasks_priority_idx" ON "agent_tasks" ("priority" DESC);

CREATE TABLE IF NOT EXISTS "memory_events" (
  "id" text PRIMARY KEY NOT NULL,
  "character_id" uuid NOT NULL REFERENCES "characters"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "event_type" text NOT NULL,
  "summary" text NOT NULL,
  "related_entry_id" text REFERENCES "wiki_entries"("id") ON DELETE SET NULL,
  "related_task_id" text REFERENCES "agent_tasks"("id") ON DELETE SET NULL,
  "source_ref" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "memory_events_event_type_check" CHECK ("event_type" IN ('observation', 'decision', 'action', 'outcome'))
);

CREATE INDEX IF NOT EXISTS "memory_events_character_created_idx"
  ON "memory_events" ("character_id", "user_id", "created_at" DESC);
