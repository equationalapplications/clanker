import assert from 'node:assert/strict'
import test from 'node:test'
import type { DrizzleClient } from '../db/client.js'

type InsertedRow = Record<string, unknown>

const mockEmbed = async (_text: string): Promise<number[]> => [0.1, 0.2, 0.3]
const failEmbed = async (_text: string): Promise<number[]> => { throw new Error('embed failed') }

function makeMockDb(queryRows: InsertedRow[] = []) {
  const txInserted: InsertedRow[] = []
  return {
    _txInserted: txInserted,
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        insert: (_table: unknown) => ({
          values: (row: InsertedRow) => {
            txInserted.push(row)
            return {
              onConflictDoUpdate: () => Promise.resolve(),
              onConflictDoNothing: () => Promise.resolve(),
            }
          },
        }),
      }
      return cb(tx)
    },
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => queryRows,
          }),
          limit: async () => queryRows,
        }),
      }),
    }),
  } as unknown as DrizzleClient & { _txInserted: InsertedRow[] }
}

const { wikiReadTool, wikiWriteTool } = await import('./wiki.js')

test('wikiReadTool: name is wiki_read', () => {
  const db = makeMockDb()
  const tool = wikiReadTool(db, 'user-1', 'char-1', mockEmbed)
  assert.equal(tool.name, 'wiki_read')
})

test('wikiReadTool: schema does not expose characterId or userId', () => {
  const db = makeMockDb()
  const tool = wikiReadTool(db, 'user-1', 'char-1', mockEmbed)
  const decl = tool._getDeclaration()
  const props = decl.parameters?.properties ?? {}
  assert.ok(!('characterId' in props))
  assert.ok(!('userId' in props))
  assert.ok('query' in props)
})

test('wikiReadTool: returns formatted context when results found', async () => {
  const rows = [
    { title: 'Diet', body: 'User is vegetarian' },
    { title: 'Pets', body: 'User likes cats' },
  ]
  const db = makeMockDb(rows as InsertedRow[])
  const tool = wikiReadTool(db, 'user-1', 'char-1', mockEmbed)
  const result = await (tool as unknown as { execute: (a: unknown) => Promise<string> }).execute({ query: 'food' })
  assert.ok(result.includes('User is vegetarian'))
  assert.ok(result.includes('User likes cats'))
})

test('wikiReadTool: returns empty string when no results', async () => {
  const db = makeMockDb([])
  const tool = wikiReadTool(db, 'user-1', 'char-1', mockEmbed)
  const result = await (tool as unknown as { execute: (a: unknown) => Promise<string> }).execute({ query: 'nothing' })
  assert.equal(result, '')
})

test('wikiWriteTool: name is wiki_write', () => {
  const db = makeMockDb()
  const tool = wikiWriteTool(db, 'user-1', 'char-1', mockEmbed)
  assert.equal(tool.name, 'wiki_write')
})

test('wikiWriteTool: schema does not expose characterId or userId', () => {
  const db = makeMockDb()
  const tool = wikiWriteTool(db, 'user-1', 'char-1', mockEmbed)
  const decl = tool._getDeclaration()
  const props = decl.parameters?.properties ?? {}
  assert.ok(!('characterId' in props))
  assert.ok(!('userId' in props))
  assert.ok('summary' in props)
})

test('wikiWriteTool: dual-write inserts entry and event in transaction', async () => {
  const db = makeMockDb()
  const tool = wikiWriteTool(db, 'user-99', 'char-42', mockEmbed)
  await (tool as unknown as { execute: (a: unknown) => Promise<string> }).execute({ summary: 'User prefers morning meetings.' })

  const rows = (db as unknown as { _txInserted: InsertedRow[] })._txInserted
  assert.equal(rows.length, 2)
  const entry = rows.find(r => 'body' in r)
  const event = rows.find(r => 'eventType' in r)
  assert.ok(entry, 'expected llm_wiki_entries insert')
  assert.ok(event, 'expected llm_wiki_events insert')
  assert.equal(entry!['entityId'], 'char-42')
  assert.equal(entry!['userId'], 'user-99')
  assert.equal(entry!['confidence'], 'inferred')
  assert.deepEqual(entry!['embedding'], [0.1, 0.2, 0.3])
  assert.equal(event!['entityId'], 'char-42')
  assert.equal(event!['eventType'], 'observation')
})

test('wikiWriteTool: inserts entry with null embedding when embed fails', async () => {
  const db = makeMockDb()
  const tool = wikiWriteTool(db, 'user-1', 'char-1', failEmbed)
  const result = await (tool as unknown as { execute: (a: unknown) => Promise<string> }).execute({ summary: 'User is left-handed.' })
  assert.equal(result, 'Observation recorded successfully.')
  const rows = (db as unknown as { _txInserted: InsertedRow[] })._txInserted
  const entry = rows.find(r => 'body' in r)
  assert.ok(entry)
  assert.equal(entry!['embedding'], null)
})

test('wikiWriteTool: returns success string', async () => {
  const db = makeMockDb()
  const tool = wikiWriteTool(db, 'user-1', 'char-1', mockEmbed)
  const result = await (tool as unknown as { execute: (a: unknown) => Promise<string> }).execute({ summary: 'User is left-handed.' })
  assert.equal(result, 'Observation recorded successfully.')
})
