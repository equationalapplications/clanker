-- Character image gallery (avatars). Mirrors the local SQLite table, minus the
-- storage_kind discriminator: cloud rows are always Firebase Storage objects.
--
-- deleted_at is the tombstone other devices reconcile against, NOT a soft-delete
-- convenience. Rows are retained for 30 days after deletion, then dropped by a
-- retention pass; the Storage objects are deleted immediately, so only the row
-- lingers and rows are tens of bytes.

CREATE TABLE IF NOT EXISTS "character_images" (
  "id" uuid PRIMARY KEY NOT NULL,
  "character_id" uuid NOT NULL REFERENCES "characters"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "storage_path" text NOT NULL,
  "thumb_path" text,
  "mime_type" text NOT NULL DEFAULT 'image/webp',
  "source" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "character_images_character_id_idx"
  ON "character_images" ("character_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "character_images_user_id_idx"
  ON "character_images" ("user_id");

-- Live-row lookup for the server-side cap: the cap counts only non-tombstoned rows.
CREATE INDEX IF NOT EXISTS "character_images_live_idx"
  ON "character_images" ("character_id", "created_at")
  WHERE "deleted_at" IS NULL;

ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "active_image_id" uuid;
