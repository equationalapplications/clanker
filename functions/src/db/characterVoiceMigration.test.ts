import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const migrationPath = path.resolve(process.cwd(), "drizzle/0003_character_voice.sql");
const defaultFixMigrationPath = path.resolve(process.cwd(), "drizzle/0019_character_voice_default_fix.sql");

// This migration ran in prod with the original 'Umbriel' default — its SQL is
// historical record and must stay frozen even after DEFAULT_VOICE changes.
// See 0019_character_voice_default_fix.sql for the corrected default.
test("character voice migration backfills null and empty values", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, /ADD COLUMN "voice" text DEFAULT 'Umbriel'/);
  assert.match(sql, /WHERE "voice" IS NULL OR "voice" = ''/i);
  assert.match(sql, /ALTER COLUMN "voice" SET NOT NULL/);
});

test("character voice default-fix migration switches default and backfills stale Umbriel rows", async () => {
  const sql = await readFile(defaultFixMigrationPath, "utf8");

  assert.match(sql, /ALTER COLUMN "voice" SET DEFAULT 'Aoede'/);
  assert.match(sql, /UPDATE "characters" SET "voice" = 'Aoede' WHERE "voice" = 'Umbriel'/);
});