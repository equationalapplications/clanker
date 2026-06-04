import assert from 'node:assert/strict'
import test from 'node:test'
import type { DrizzleClient } from '../db/client.js'

const { documentSearchTool } = await import('./documents.js')

test('documentSearchTool: name is document_search', () => {
  const tool = documentSearchTool({} as DrizzleClient, 'u', 'c')
  assert.equal(tool.name, 'document_search')
})

test('documentSearchTool: returns stub message', async () => {
  const tool = documentSearchTool({} as DrizzleClient, 'u', 'c')
  const result = await (tool as unknown as { execute: (a: unknown) => Promise<string> }).execute({ query: 'test' })
  assert.ok(typeof result === 'string')
})