import assert from 'node:assert/strict'
import test from 'node:test'
import type { DrizzleClient } from '../db/client.js'

type Row = Record<string, unknown>

function makeMockSelectDb(selectRows: Row[]) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => selectRows,
        }),
      }),
    }),
  } as unknown as DrizzleClient
}

function makeMockExecuteDb(executeResults: Row[][]) {
  let call = 0
  return {
    execute: async (_query: unknown) => {
      const rows = executeResults[call] ?? []
      call += 1
      return { rows }
    },
  } as unknown as DrizzleClient
}

const { wikiGetOntologyManifestTool, wikiTraverseGraphTool } = await import('./ontology.js')

test('wikiGetOntologyManifestTool: name is wiki_get_ontology_manifest', () => {
  const db = makeMockSelectDb([])
  const tool = wikiGetOntologyManifestTool(db, 'user-1', 'char-1')
  assert.equal(tool.name, 'wiki_get_ontology_manifest')
})

test('wikiGetOntologyManifestTool: schema has no parameters', () => {
  const db = makeMockSelectDb([])
  const tool = wikiGetOntologyManifestTool(db, 'user-1', 'char-1')
  const decl = tool._getDeclaration()
  assert.deepEqual(decl.parameters?.properties ?? {}, {})
})

test('wikiGetOntologyManifestTool: returns off/null when no row exists', async () => {
  const db = makeMockSelectDb([])
  const tool = wikiGetOntologyManifestTool(db, 'user-1', 'char-1')
  const result = await (tool as unknown as { execute: () => Promise<string> }).execute()
  assert.deepEqual(JSON.parse(result), { mode: 'off', manifest: null })
})

test('wikiGetOntologyManifestTool: returns stored mode and manifest when a row exists', async () => {
  const manifest = { node_types: [{ type: 'person', description: 'A person' }], edge_types: [] }
  const db = makeMockSelectDb([{ mode: 'emergent', manifest }])
  const tool = wikiGetOntologyManifestTool(db, 'user-1', 'char-1')
  const result = await (tool as unknown as { execute: () => Promise<string> }).execute()
  assert.deepEqual(JSON.parse(result), { mode: 'emergent', manifest })
})

test('wikiTraverseGraphTool: name is wiki_traverse_graph', () => {
  const db = makeMockExecuteDb([])
  const tool = wikiTraverseGraphTool(db, 'user-1', 'char-1')
  assert.equal(tool.name, 'wiki_traverse_graph')
})

test('wikiTraverseGraphTool: schema does not expose entityId or userId', () => {
  const db = makeMockExecuteDb([])
  const tool = wikiTraverseGraphTool(db, 'user-1', 'char-1')
  const decl = tool._getDeclaration()
  const props = decl.parameters?.properties ?? {}
  assert.ok(!('entityId' in props))
  assert.ok(!('userId' in props))
  assert.ok('sourceId' in props)
})

test('wikiTraverseGraphTool: returns failure string when sourceId is missing', async () => {
  const db = makeMockExecuteDb([])
  const tool = wikiTraverseGraphTool(db, 'user-1', 'char-1')
  const result = await (tool as unknown as { execute: (a: unknown) => Promise<string> }).execute({ sourceId: '' })
  assert.equal(result, 'Failed to traverse graph: sourceId is required.')
})

test('wikiTraverseGraphTool: returns "No graph data found" when traversal is empty', async () => {
  const db = makeMockExecuteDb([[]])
  const tool = wikiTraverseGraphTool(db, 'user-1', 'char-1')
  const result = await (tool as unknown as { execute: (a: unknown) => Promise<string> }).execute({ sourceId: 'missing' })
  assert.equal(result, 'No graph data found for that node.')
})

test('wikiTraverseGraphTool: formats a found neighborhood via formatGraphContext', async () => {
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
    { id: 'edge-1', source_id: 'fact-1', target_id: 'fact-2', edge_type: 'knows', created_at: '120' },
  ]
  const db = makeMockExecuteDb([nodeRows, edgeRows])
  const tool = wikiTraverseGraphTool(db, 'user-1', 'char-1')
  const result = await (tool as unknown as { execute: (a: unknown) => Promise<string> }).execute({ sourceId: 'fact-1' })
  assert.ok(result.includes('Anchor'))
  assert.ok(result.includes('Neighbor'))
  assert.ok(result.includes('knows'))
})
