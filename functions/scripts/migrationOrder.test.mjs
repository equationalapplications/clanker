import test from 'node:test';
import assert from 'node:assert/strict';
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

test('untracked files are not ordering-checked', () => {
  assert.deepEqual(missingPrerequisites('9999_adhoc.sql', new Set()), []);
});

test('missing prerequisites are reported in apply order', () => {
  const target = '0005_subscriptions_document_counter.sql';
  const missing = missingPrerequisites(target, new Set());
  assert.deepEqual(missing, MIGRATION_ORDER.slice(0, migrationIndex(target)));
});
