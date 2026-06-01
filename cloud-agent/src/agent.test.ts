import assert from 'node:assert/strict'
import test from 'node:test'
import type { DrizzleClient } from './db/client.js'

const mockDb = {} as unknown as DrizzleClient

const { buildAgent } = await import('./agent.js')

test('buildAgent: returns LlmAgent with 4 tools', () => {
  const agent = buildAgent(mockDb, 'user-1', 'char-1', 'You are Alice.')
  assert.equal(agent.tools.length, 4)
})

test('buildAgent: registers all required tool names', () => {
  const agent = buildAgent(mockDb, 'user-1', 'char-1', 'You are Alice.')
  const names = agent.tools.map((t) => (t as { name: string }).name)
  assert.ok(names.includes('create_task'), 'missing create_task')
  assert.ok(names.includes('list_tasks'), 'missing list_tasks')
  assert.ok(names.includes('wiki_read'), 'missing wiki_read')
  assert.ok(names.includes('wiki_write'), 'missing wiki_write')
})

test('buildAgent: sets instruction from parameter', () => {
  const agent = buildAgent(mockDb, 'user-1', 'char-1', 'You are Bob, a chef.')
  assert.equal(agent.instruction, 'You are Bob, a chef.')
})

test('buildAgent: model is gemini-2.0-flash', () => {
  const agent = buildAgent(mockDb, 'user-1', 'char-1', 'You are Alice.')
  assert.equal(agent.model, 'gemini-2.0-flash')
})
