import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const initialMigrationPath = path.resolve(process.cwd(), "drizzle/0000_dazzling_kid_colt.sql");

test("users.created_at and users.updated_at are NOT NULL in migration", async () => {
  const sql = await readFile(initialMigrationPath, "utf8");

  assert.match(sql, /"created_at" timestamp with time zone DEFAULT now\(\) NOT NULL,/);
  assert.match(sql, /"updated_at" timestamp with time zone DEFAULT now\(\) NOT NULL,/);
});
