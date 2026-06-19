import assert from 'node:assert/strict'
import test from 'node:test'
import type { DrizzleClient } from './db/client.js'

const mockDb = {} as unknown as DrizzleClient
const mockEmbed = async (_text: string): Promise<number[]> => [0.1, 0.2]
const timezone = 'UTC'

const { buildAgent } = await import('./agent.js')

test('buildAgent: returns LlmAgent with 11 tools', () => {
  const agent = buildAgent(mockDb, 'user-1', 'char-1', 'You are Alice.', timezone, mockEmbed)
  assert.equal(agent.tools.length, 11)
})

test('buildAgent: registers all required tool names', () => {
  const agent = buildAgent(mockDb, 'user-1', 'char-1', 'You are Alice.', timezone, mockEmbed)
  const names = agent.tools.map((t) => (t as { name: string }).name)
  assert.ok(names.includes('create_task'), 'missing create_task')
  assert.ok(names.includes('list_tasks'), 'missing list_tasks')
  assert.ok(names.includes('wiki_read'), 'missing wiki_read')
  assert.ok(names.includes('wiki_write'), 'missing wiki_write')
  assert.ok(names.includes('get_current_time'), 'missing get_current_time')
  assert.ok(names.includes('update_task'), 'missing update_task')
  assert.ok(names.includes('complete_task'), 'missing complete_task')
  assert.ok(names.includes('delete_task'), 'missing delete_task')
  assert.ok(names.includes('document_search'), 'missing document_search')
  assert.ok(names.includes('set_reminder'), 'missing set_reminder')
  assert.ok(names.includes('google_search'), 'missing google_search')
})

test('buildAgent: sets instruction from parameter', () => {
  const agent = buildAgent(mockDb, 'user-1', 'char-1', 'You are Bob, a chef.', timezone, mockEmbed)
  assert.equal(agent.instruction, 'You are Bob, a chef.')
})

test('buildAgent: model is gemini-3.5-flash', () => {
  const agent = buildAgent(mockDb, 'user-1', 'char-1', 'You are Alice.', timezone, mockEmbed)
  assert.equal(agent.model, 'gemini-3.5-flash')
})
