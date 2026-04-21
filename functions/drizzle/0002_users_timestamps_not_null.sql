UPDATE "users"
SET "created_at" = now()
WHERE "created_at" IS NULL;

--> statement-breakpoint
UPDATE "users"
SET "updated_at" = now()
WHERE "updated_at" IS NULL;

--> statement-breakpoint
ALTER TABLE "users"
ALTER COLUMN "created_at" SET NOT NULL;

--> statement-breakpoint
ALTER TABLE "users"
ALTER COLUMN "updated_at" SET NOT NULL;