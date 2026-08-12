import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const sql = readFileSync(join(process.cwd(), 'drizzle', '0022_character_images.sql'), 'utf8')

test('creates character_images with the cloud column shape', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "character_images"/)
  assert.match(sql, /"storage_path" text NOT NULL/)
  assert.match(sql, /"thumb_path" text/)
  assert.match(sql, /"mime_type" text NOT NULL DEFAULT 'image\/webp'/)
  assert.match(sql, /"deleted_at" timestamp with time zone/)
})

test('cascades from characters and users', () => {
  assert.match(sql, /REFERENCES "characters"\("id"\) ON DELETE CASCADE/)
  assert.match(sql, /REFERENCES "users"\("id"\) ON DELETE CASCADE/)
})

test('indexes the reconciliation lookup', () => {
  assert.match(sql, /character_images_character_id_idx/)
  assert.match(sql, /character_images_user_id_idx/)
})

test('adds characters.active_image_id', () => {
  assert.match(sql, /ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "active_image_id" uuid/)
})

test('is re-runnable', () => {
  assert.match(sql, /IF NOT EXISTS/)
  assert.doesNotMatch(sql, /DROP TABLE/)
})
