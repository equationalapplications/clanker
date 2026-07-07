-- Umbriel was not in the voice allow-list at the time, causing the server to
-- silently fall back to Aoede. Switch the column default and backfill existing
-- rows still on the stale value.
ALTER TABLE "characters" ALTER COLUMN "voice" SET DEFAULT 'Aoede';
UPDATE "characters" SET "voice" = 'Aoede' WHERE "voice" = 'Umbriel';
