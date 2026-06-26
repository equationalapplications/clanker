import assert from 'node:assert/strict'
import test from 'node:test'
import type { DrizzleClient } from '../db/client.js'
import { resolveVoice, buildLiveTools } from './liveToolAdapter.js'

const mockDb = {} as unknown as DrizzleClient
const mockEmbed = async (_text: string): Promise<number[]> => []

test('resolveVoice returns Aoede for unknown voice', () => {
  assert.equal(resolveVoice('Umbriel'), 'Aoede')
})

test('resolveVoice returns Aoede for null', () => {
  assert.equal(resolveVoice(null), 'Aoede')
})

test('resolveVoice returns Aoede for undefined', () => {
  assert.equal(resolveVoice(undefined), 'Aoede')
})

test('resolveVoice passes through valid Live API voice', () => {
  assert.equal(resolveVoice('Puck'), 'Puck')
  assert.equal(resolveVoice('Aoede'), 'Aoede')
  assert.equal(resolveVoice('Charon'), 'Charon')
  assert.equal(resolveVoice('Fenrir'), 'Fenrir')
  assert.equal(resolveVoice('Kore'), 'Kore')
})

test('buildLiveTools returns 12 declarations', () => {
  const { declarations } = buildLiveTools(mockDb, 'user-1', 'char-1', mockEmbed, 'UTC')
  assert.equal(declarations.length, 12)
})

test('buildLiveTools declarations each have name, description, parameters', () => {
  const { declarations } = buildLiveTools(mockDb, 'user-1', 'char-1', mockEmbed, 'UTC')
  for (const decl of declarations) {
    assert.ok(typeof decl.name === 'string' && decl.name.length > 0, `${decl.name}: missing name`)
    assert.ok(typeof decl.description === 'string' && decl.description.length > 0, `${decl.name}: missing description`)
    assert.ok(decl.parameters !== undefined, `${decl.name}: missing parameters`)
  }
})

test('buildLiveTools executors map has entry for every declared tool', () => {
  const { declarations, executors } = buildLiveTools(mockDb, 'user-1', 'char-1', mockEmbed, 'UTC')
  for (const decl of declarations) {
    const name = decl.name ?? 'unknown'
    assert.ok(executors.has(name), `missing executor for ${name}`)
    assert.equal(typeof executors.get(name), 'function')
  }
})
