-- Umbriel was never a valid live-voice option (server silently fell back to Aoede),
-- so switch the column default and backfill existing rows still on it.
ALTER TABLE "characters" ALTER COLUMN "voice" SET DEFAULT 'Aoede';
UPDATE "characters" SET "voice" = 'Aoede' WHERE "voice" = 'Umbriel';
