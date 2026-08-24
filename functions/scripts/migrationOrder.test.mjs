import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIGRATION_ORDER, migrationIndex, missingPrerequisites } from './migrationOrder.mjs';

test('MIGRATION_ORDER has no duplicates', () => {
  assert.equal(new Set(MIGRATION_ORDER).size, MIGRATION_ORDER.length);
});

test('migrationIndex returns -1 for untracked files', () => {
  assert.equal(migrationIndex('9999_not_a_real_migration.sql'), -1);
  assert.equal(migrationIndex(MIGRATION_ORDER[0]), 0);
});

test('no missing prerequisites when everything earlier is applied', () => {
  const target = '0021_fix_handle_new_user_trigger_power_scale.sql';
  const applied = new Set(MIGRATION_ORDER.slice(0, migrationIndex(target)));
  assert.deepEqual(missingPrerequisites(target, applied), []);
});

test('the first migration never has prerequisites', () => {
  assert.deepEqual(missingPrerequisites(MIGRATION_ORDER[0], new Set()), []);
});

test('regression: 0021 is refused when 0001 was never applied', () => {
  // The 2026-08-01 production incident. 0021's trigger does
  // ON CONFLICT (user_id, reason, reference_id) WHERE reference_id IS NOT NULL,
  // whose arbiter index is created by 0001. Applying 0021 without 0001 left
  // every signup failing with 42P10.
  const applied = new Set(
    MIGRATION_ORDER.slice(0, migrationIndex('0021_fix_handle_new_user_trigger_power_scale.sql'))
  );
  applied.delete('0001_credit_transactions_idempotency.sql');

  const missing = missingPrerequisites('0021_fix_handle_new_user_trigger_power_scale.sql', applied);
  assert.deepEqual(missing, ['0001_credit_transactions_idempotency.sql']);
});

test('a prerequisite scheduled earlier in the same batch counts as satisfied', () => {
  const applied = new Set();
  const batch = MIGRATION_ORDER.slice(0, 3);
  assert.deepEqual(missingPrerequisites(MIGRATION_ORDER[2], applied, batch), []);
});

test('a prerequisite scheduled later in the same batch is still reported missing', () => {
  // Regression for reviewer feedback: passing a mis-ordered batch (e.g. the full
  // MIGRATION_ORDER with `filename` not actually first) must not let a
  // later-scheduled prerequisite count as satisfied, or the 0021-without-0001
  // incident class reappears.
  const applied = new Set();
  const target = MIGRATION_ORDER[1];
  const prerequisite = MIGRATION_ORDER[0];
  // `target` is scheduled before its own prerequisite in this batch — inverted.
  const batch = [target, prerequisite];
  assert.deepEqual(missingPrerequisites(target, applied, batch), [prerequisite]);
});

test('untracked files are not ordering-checked', () => {
  assert.deepEqual(missingPrerequisites('9999_adhoc.sql', new Set()), []);
});

test('missing prerequisites are reported in apply order', () => {
  const target = '0005_subscriptions_document_counter.sql';
  const missing = missingPrerequisites(target, new Set());
  assert.deepEqual(missing, MIGRATION_ORDER.slice(0, migrationIndex(target)));
});

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

test('0025_drop_characters_avatar.sql is registered in MIGRATION_ORDER', () => {
  // Inclusion, not "is last": a positional pin would fail on every future
  // migration appended after 0025, and the shape guard below already pins
  // 0025's contents.
  assert.ok(MIGRATION_ORDER.includes('0025_drop_characters_avatar.sql'));
});

test("0025's SQL drops the avatar column and nothing else", () => {
  // Shape guard: the journal is out of sync, so an accidental `drizzle-kit
  // generate` could swap different SQL in under a registered filename. Pin the
  // exact text — this starts the repo's first SQL-text-shape convention.
  const sql = readFileSync(join(DRIZZLE_DIR, '0025_drop_characters_avatar.sql'), 'utf8').trim();
  assert.equal(sql, 'ALTER TABLE characters DROP COLUMN IF EXISTS avatar;');
});
