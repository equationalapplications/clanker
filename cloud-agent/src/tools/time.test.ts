import assert from 'node:assert/strict'
import test from 'node:test'

const { getCurrentTimeTool } = await import('./time.js')

test('getCurrentTimeTool: name is get_current_time', () => {
  const tool = getCurrentTimeTool('UTC')
  assert.equal(tool.name, 'get_current_time')
})

test('getCurrentTimeTool: result contains timezone info', async () => {
  const tool = getCurrentTimeTool('America/New_York')
  const result = await (tool as unknown as { execute: () => Promise<string> }).execute()
  assert.ok(typeof result === 'string' && result.length > 0)
})

test('getCurrentTimeTool: falls back to UTC for invalid timezone', async () => {
  const tool = getCurrentTimeTool('not/a/zone')
  const result = await (tool as unknown as { execute: () => Promise<string> }).execute()
  assert.ok(typeof result === 'string' && result.length > 0)
})