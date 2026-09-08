import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const sqlText = readFileSync(join(process.cwd(), 'drizzle', '0026_scheduled_wakeups.sql'), 'utf8')

test('creates scheduled_wakeups with the wake-up shape', () => {
  assert.match(sqlText, /CREATE TABLE IF NOT EXISTS scheduled_wakeups/)
  assert.match(sqlText, /id text PRIMARY KEY/)
  assert.match(sqlText, /character_id uuid NOT NULL REFERENCES characters\(id\) ON DELETE CASCADE/)
  assert.match(sqlText, /user_id uuid NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/)
  assert.match(sqlText, /reason text NOT NULL/)
  assert.match(sqlText, /due_at timestamptz NOT NULL/)
  assert.match(sqlText, /priority integer NOT NULL DEFAULT 0/)
  assert.match(sqlText, /status text NOT NULL DEFAULT 'pending'/)
  assert.match(sqlText, /run_key text NOT NULL/)
  assert.match(sqlText, /spent_amount integer NOT NULL DEFAULT 0/)
  assert.match(sqlText, /created_at timestamptz NOT NULL DEFAULT now\(\)/)
})

test('constrains status to the documented vocabulary', () => {
  assert.match(sqlText, /scheduled_wakeups_status_check/)
  for (const value of ['pending', 'claimed', 'done', 'skipped', 'cancelled']) {
    assert.match(sqlText, new RegExp(`'${value}'`))
  }
})

test('indexes the sweep, the cap check and the retention delete', () => {
  assert.match(sqlText, /scheduled_wakeups_status_due_idx/)
  assert.match(sqlText, /\(status, due_at\)/)
  assert.match(sqlText, /scheduled_wakeups_character_status_idx/)
  assert.match(sqlText, /\(character_id, status\)/)
  assert.match(sqlText, /scheduled_wakeups_resolved_at_idx/)
  assert.match(sqlText, /scheduled_wakeups_run_key_unique_idx/)
  assert.match(sqlText, /UNIQUE INDEX/)
})

test('is re-runnable', () => {
  assert.match(sqlText, /IF NOT EXISTS/)
  assert.doesNotMatch(sqlText, /DROP TABLE|DROP INDEX/)
})
