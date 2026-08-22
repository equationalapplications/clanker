import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const sqlText = readFileSync(join(process.cwd(), 'drizzle', '0024_credit_spend_events.sql'), 'utf8')

test('creates credit_spend_events with the ledger shape', () => {
  assert.match(sqlText, /CREATE TABLE IF NOT EXISTS credit_spend_events/)
  assert.match(sqlText, /id uuid PRIMARY KEY DEFAULT gen_random_uuid\(\)/)
  assert.match(sqlText, /user_id uuid NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/)
  assert.match(sqlText, /amount integer NOT NULL/)
  assert.match(sqlText, /reason text NOT NULL/)
  assert.match(sqlText, /created_at timestamptz NOT NULL DEFAULT now\(\)/)
})

test('indexes the per-user time series and the reason rollup', () => {
  assert.match(sqlText, /CREATE INDEX IF NOT EXISTS credit_spend_events_user_created_idx/)
  assert.match(sqlText, /\(user_id, created_at DESC\)/)
  assert.match(sqlText, /credit_spend_events_reason_idx ON credit_spend_events \(reason\)/)
})

test('is re-runnable', () => {
  assert.match(sqlText, /IF NOT EXISTS/)
  assert.doesNotMatch(sqlText, /DROP TABLE|DROP INDEX/)
})
