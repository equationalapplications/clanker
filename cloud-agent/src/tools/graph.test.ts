import assert from 'node:assert/strict'
import test from 'node:test'
import type { DrizzleClient } from '../db/client.js'

type Row = Record<string, unknown>

function flattenSql(query: unknown): string {
  const parts: string[] = []
  const walk = (value: unknown) => {
    if (typeof value === 'string') {
      parts.push(value)
      return
    }
    if (!value || typeof value !== 'object') return
    const obj = value as { value?: unknown[]; queryChunks?: unknown[] }
    if (Array.isArray(obj.value)) {
      for (const v of obj.value) walk(v)
    }
    if (Array.isArray(obj.queryChunks)) {
      for (const chunk of obj.queryChunks) walk(chunk)
    }
  }
  walk(query)
  return parts.join('')
}

function makeMockDb(executeResults: Row[][]) {
  let call = 0
  const calls: unknown[] = []
  return {
    execute: async (query: unknown) => {
      calls.push(query)
      const rows = executeResults[call] ?? []
      call += 1
      return { rows }
    },
    _calls: calls,
  } as unknown as DrizzleClient & { _calls: unknown[] }
}

const { traverseGraphCte } = await import('./graph.js')

test('traverseGraphCte: returns anchor only when edgeTypes is an explicit empty array', async () => {
  const anchorRow = {
    id: 'fact-1', title: 'T', body: 'B', tags: [], confidence: 'inferred', source_type: 'agent_inferred',
    source_ref: null, source_hash: null, last_accessed_at: null, access_count: 0,
    created_at: '100', updated_at: '200', deleted_at: null,
  }
  const db = makeMockDb([[anchorRow]])
  const result = await traverseGraphCte(db, 'user-1', 'entity-1', { sourceId: 'fact-1', edgeTypes: [] })
  assert.equal(result.nodes.length, 1)
  assert.equal(result.nodes[0].id, 'fact-1')
  assert.equal(result.edges.length, 0)
  assert.equal((db as unknown as { _calls: unknown[] })._calls.length, 1)
})

test('traverseGraphCte: returns empty neighborhood when anchor not found (edgeTypes empty)', async () => {
  const db = makeMockDb([[]])
  const result = await traverseGraphCte(db, 'user-1', 'entity-1', { sourceId: 'missing', edgeTypes: [] })
  assert.deepEqual(result, { nodes: [], edges: [] })
})

test('traverseGraphCte: returns empty neighborhood when anchor not found (default traversal)', async () => {
  const db = makeMockDb([[]])
  const result = await traverseGraphCte(db, 'user-1', 'entity-1', { sourceId: 'missing' })
  assert.deepEqual(result, { nodes: [], edges: [] })
  assert.equal((db as unknown as { _calls: unknown[] })._calls.length, 1)
})

test('traverseGraphCte: maps node rows to WikiFact shape and fetches edges among found node ids', async () => {
  const nodeRows = [
    {
      id: 'fact-1', title: 'Anchor', body: 'B1', tags: ['a'], confidence: 'certain', source_type: 'agent_inferred',
      source_ref: null, source_hash: null, last_accessed_at: '500', access_count: 3,
      created_at: '100', updated_at: '300', deleted_at: null, depth: 0,
    },
    {
      id: 'fact-2', title: 'Neighbor', body: 'B2', tags: [], confidence: 'inferred', source_type: 'agent_inferred',
      source_ref: null, source_hash: null, last_accessed_at: null, access_count: 0,
      created_at: '150', updated_at: '350', deleted_at: null, depth: 1,
    },
  ]
  const edgeRows = [
    { id: 'edge-1', source_id: 'fact-1', target_id: 'fact-2', edge_type: 'relates_to', created_at: '120' },
  ]
  const db = makeMockDb([nodeRows, edgeRows])
  const result = await traverseGraphCte(db, 'user-1', 'entity-1', { sourceId: 'fact-1', maxDepth: 2 })

  assert.equal(result.nodes.length, 2)
  assert.equal(result.nodes[0].id, 'fact-1')
  assert.equal(result.nodes[0].created_at, 100)
  assert.equal(result.nodes[0].updated_at, 300)
  assert.equal(result.nodes[0].last_accessed_at, 500)
  assert.equal(result.nodes[1].id, 'fact-2')
  assert.equal(result.edges.length, 1)
  assert.equal(result.edges[0].id, 'edge-1')
  assert.equal(result.edges[0].entity_id, 'entity-1')
  assert.equal(result.edges[0].source_id, 'fact-1')
  assert.equal(result.edges[0].target_id, 'fact-2')
  assert.equal((db as unknown as { _calls: unknown[] })._calls.length, 2)
})

test('traverseGraphCte: filters returned edges by edgeTypes', async () => {
  const nodeRows = [
    {
      id: 'fact-1', title: 'Anchor', body: 'B1', tags: [], confidence: 'certain', source_type: 'agent_inferred',
      source_ref: null, source_hash: null, last_accessed_at: null, access_count: 0,
      created_at: '100', updated_at: '300', deleted_at: null, depth: 0,
    },
    {
      id: 'fact-2', title: 'Neighbor', body: 'B2', tags: [], confidence: 'inferred', source_type: 'agent_inferred',
      source_ref: null, source_hash: null, last_accessed_at: null, access_count: 0,
      created_at: '150', updated_at: '350', deleted_at: null, depth: 1,
    },
  ]
  const edgeRows = [
    { id: 'edge-1', source_id: 'fact-1', target_id: 'fact-2', edge_type: 'relates_to', created_at: '120' },
    { id: 'edge-2', source_id: 'fact-1', target_id: 'fact-2', edge_type: 'other_type', created_at: '121' },
  ]
  let call = 0
  const calls: unknown[] = []
  const db = {
    execute: async (query: unknown) => {
      calls.push(query)
      if (call === 0) {
        call += 1
        return { rows: nodeRows }
      }
      const sqlText = flattenSql(query)
      const filtered = sqlText.includes('edge_type IN') && sqlText.includes('relates_to')
        ? edgeRows.filter((e) => e.edge_type === 'relates_to')
        : edgeRows
      call += 1
      return { rows: filtered }
    },
    _calls: calls,
  } as unknown as DrizzleClient & { _calls: unknown[] }
  const result = await traverseGraphCte(db, 'user-1', 'entity-1', {
    sourceId: 'fact-1',
    maxDepth: 2,
    edgeTypes: ['relates_to'],
  })

  assert.equal(result.edges.length, 1)
  assert.equal(result.edges[0].edge_type, 'relates_to')
})
