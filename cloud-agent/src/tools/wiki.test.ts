import assert from 'node:assert/strict'
import test from 'node:test'
import type { DrizzleClient } from '../db/client.js'

type InsertedRow = Record<string, unknown>

function makeMockDb(queryRows: InsertedRow[] = []) {
  const inserted: InsertedRow[] = []
  return {
    _inserted: inserted,
    insert: (_table: unknown) => ({
      values: async (row: InsertedRow) => { inserted.push(row) },
    }),
    select: (_fields?: unknown) => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => ({
          limit: async (_n: unknown) => queryRows,
        }),
      }),
    }),
  } as unknown as DrizzleClient & { _inserted: InsertedRow[] }
}

const { wikiReadTool, wikiWriteTool } = await import('./wiki.js')

test('wikiReadTool: name is wiki_read', () => {
  const db = makeMockDb()
  const tool = wikiReadTool(db, 'user-1', 'char-1')
  assert.equal(tool.name, 'wiki_read')
})

test('wikiReadTool: schema does not expose characterId', () => {
  const db = makeMockDb()
  const tool = wikiReadTool(db, 'user-1', 'char-1')
  const decl = tool._getDeclaration()
  const props = decl.parameters?.properties ?? {}
  assert.ok(!('characterId' in props))
  assert.ok(!('userId' in props))
  assert.ok('query' in props)
})

test('wikiReadTool: returns formatted context string when results found', async () => {
  const rows = [
    { summary: 'User likes cats' },
    { summary: 'User is vegetarian' },
  ]
  const db = makeMockDb(rows as InsertedRow[])
  const tool = wikiReadTool(db, 'user-1', 'char-1')
  const result = await (tool as unknown as { execute: (args: unknown) => Promise<string> })
    .execute({ query: 'food' })
  assert.ok(result.includes('User likes cats'))
  assert.ok(result.includes('User is vegetarian'))
})

test('wikiReadTool: returns empty string when no results', async () => {
  const db = makeMockDb([])
  const tool = wikiReadTool(db, 'user-1', 'char-1')
  const result = await (tool as unknown as { execute: (args: unknown) => Promise<string> })
    .execute({ query: 'nothing' })
  assert.equal(result, '')
})

test('wikiWriteTool: name is wiki_write', () => {
  const db = makeMockDb()
  const tool = wikiWriteTool(db, 'user-1', 'char-1')
  assert.equal(tool.name, 'wiki_write')
})

test('wikiWriteTool: schema does not expose characterId or userId', () => {
  const db = makeMockDb()
  const tool = wikiWriteTool(db, 'user-1', 'char-1')
  const decl = tool._getDeclaration()
  const props = decl.parameters?.properties ?? {}
  assert.ok(!('characterId' in props))
  assert.ok(!('userId' in props))
  assert.ok('summary' in props)
})

test('wikiWriteTool: inserts observation with closure values', async () => {
  const db = makeMockDb()
  const tool = wikiWriteTool(db, 'user-99', 'char-42')
  await (tool as unknown as { execute: (args: unknown) => Promise<string> })
    .execute({ summary: 'User prefers morning meetings' })

  const row = (db as unknown as { _inserted: InsertedRow[] })._inserted[0]
  assert.ok(row, 'expected one inserted row')
  assert.equal(row['entityId'], 'char-42')
  assert.equal(row['userId'], 'user-99')
  assert.equal(row['eventType'], 'observation')
  assert.equal(row['summary'], 'User prefers morning meetings')
  assert.ok(typeof row['createdAt'] === 'number')
})

test('wikiWriteTool: returns success string', async () => {
  const db = makeMockDb()
  const tool = wikiWriteTool(db, 'user-1', 'char-1')
  const result = await (tool as unknown as { execute: (args: unknown) => Promise<string> })
    .execute({ summary: 'User is left-handed' })
  assert.equal(result, 'Observation recorded successfully.')
})
