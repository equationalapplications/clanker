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

// Migration 0027 widened the status vocabulary and added the reaper index. The
// drizzle schema in src/db/schema.ts is a hand-maintained mirror of the prod
// DDL — nothing regenerates it — so it can silently fall behind a hand-written
// migration. It did: 0027 shipped 'running' (claimRunKey writes it) while both
// mirrors still declared the five-value CHECK. These tests pin the mirror to
// the migration so the next widening cannot drift the same way.
const runningSql = readFileSync(
  join(process.cwd(), 'drizzle', '0027_scheduled_wakeups_running_status.sql'),
  'utf8',
)

const schemaSource = readFileSync(join(process.cwd(), 'src', 'db', 'schema.ts'), 'utf8')

test('0027 adds the running status and the stale-claim reaper index', () => {
  assert.match(runningSql, /DROP CONSTRAINT IF EXISTS scheduled_wakeups_status_check/)
  assert.match(
    runningSql,
    /CHECK \(status IN \('pending', 'claimed', 'running', 'done', 'skipped', 'cancelled'\)\)/,
  )
  assert.match(runningSql, /CREATE INDEX IF NOT EXISTS scheduled_wakeups_claimed_at_idx/)
  assert.match(runningSql, /WHERE resolved_at IS NULL/)
})

test('the schema mirror carries the same status vocabulary as 0027', () => {
  // 'running' is the value that actually drifted: cloud-agent's claimRunKey
  // writes it, so a mirror that omits it disagrees with prod.
  assert.match(
    schemaSource,
    /IN \('pending', 'claimed', 'running', 'done', 'skipped', 'cancelled'\)/,
  )
  assert.doesNotMatch(
    schemaSource,
    /IN \('pending', 'claimed', 'done', 'skipped', 'cancelled'\)/,
    'schema mirror still declares the pre-0027 status CHECK',
  )
})

test('the schema mirror carries the reaper index from 0027', () => {
  assert.match(schemaSource, /scheduled_wakeups_claimed_at_idx/)
})
