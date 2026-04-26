import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const migrationPath = path.resolve(process.cwd(), "drizzle/0003_character_voice.sql");

test("character voice migration backfills null and empty values", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, /ADD COLUMN "voice" text DEFAULT 'Umbriel'/);
  assert.match(sql, /WHERE "voice" IS NULL OR "voice" = ''/);
  assert.match(sql, /ALTER COLUMN "voice" SET NOT NULL/);
});