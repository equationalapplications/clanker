ALTER TABLE "characters" ADD COLUMN "voice" text DEFAULT 'Umbriel';
UPDATE "characters" SET "voice" = 'Umbriel' WHERE "voice" IS NULL OR "voice" = '';
ALTER TABLE "characters" ALTER COLUMN "voice" SET NOT NULL;
