import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { DEFAULT_VOICE } from "../constants/voiceDefaults.js";

const migrationPath = path.resolve(process.cwd(), "drizzle/0003_character_voice.sql");

test("character voice migration backfills null and empty values", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, new RegExp(`ADD COLUMN "voice" text DEFAULT '${DEFAULT_VOICE}'`));
  assert.match(sql, /WHERE "voice" IS NULL OR "voice" = ''/i);
  assert.match(sql, /ALTER COLUMN "voice" SET NOT NULL/);
});