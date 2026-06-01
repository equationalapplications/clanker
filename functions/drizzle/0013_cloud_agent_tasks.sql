CREATE TABLE "tasks" (
  "id" text PRIMARY KEY NOT NULL,
  "character_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "title" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "tasks_status_check" CHECK (status IN ('open', 'done', 'abandoned'))
);

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_character_id_characters_id_fk"
  FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX "tasks_character_user_idx" ON "tasks" ("character_id", "user_id");
