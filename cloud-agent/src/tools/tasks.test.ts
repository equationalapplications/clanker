import assert from 'node:assert/strict'
import test from 'node:test'
import type { DrizzleClient } from '../db/client.js'

// Inline mock db factory — no imports needed, no module mocking.
type InsertedRow = Record<string, unknown>

function makeMockDb(queryRows: InsertedRow[] = []) {
  const inserted: InsertedRow[] = []
  return {
    _inserted: inserted,
    insert: (_table: unknown) => ({
      values: async (row: InsertedRow) => { inserted.push(row) },
    }),
    select: () => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => ({
          orderBy: async (_order: unknown) => queryRows,
        }),
      }),
    }),
  } as unknown as DrizzleClient & { _inserted: InsertedRow[] }
}

const { createTaskTool, listTasksTool } = await import('./tasks.js')

test('createTaskTool: name is create_task', () => {
  const db = makeMockDb()
  const tool = createTaskTool(db, 'user-1', 'char-1')
  assert.equal(tool.name, 'create_task')
})

test('createTaskTool: schema does not expose userId or characterId', () => {
  const db = makeMockDb()
  const tool = createTaskTool(db, 'user-1', 'char-1')
  const decl = tool._getDeclaration()
  const props = decl.parameters?.properties ?? {}
  assert.ok(!('userId' in props), 'userId must not be in schema')
  assert.ok(!('characterId' in props), 'characterId must not be in schema')
  assert.ok('title' in props, 'title must be in schema')
})

test('createTaskTool: inserts row with closure userId and characterId', async () => {
  const db = makeMockDb()
  const tool = createTaskTool(db, 'user-abc', 'char-xyz')
  await (tool as unknown as { execute: (args: unknown) => Promise<string> })
    .execute({ title: 'Buy milk' })

  const row = (db as unknown as { _inserted: InsertedRow[] })._inserted[0]
  assert.ok(row, 'expected one inserted row')
  assert.equal(row['characterId'], 'char-xyz')
  assert.equal(row['userId'], 'user-abc')
  assert.equal(row['title'], 'Buy milk')
  assert.equal(row['status'], 'open')
  assert.ok(typeof row['id'] === 'string' && row['id'].length > 0)
})

test('createTaskTool: returns JSON with taskId and title', async () => {
  const db = makeMockDb()
  const tool = createTaskTool(db, 'user-1', 'char-1')
  const result = await (tool as unknown as { execute: (args: unknown) => Promise<string> })
    .execute({ title: 'Walk dog' })
  const parsed = JSON.parse(result) as { taskId: string; title: string }
  assert.equal(parsed.title, 'Walk dog')
  assert.ok(typeof parsed.taskId === 'string')
})

test('listTasksTool: name is list_tasks', () => {
  const db = makeMockDb()
  const tool = listTasksTool(db, 'user-1', 'char-1')
  assert.equal(tool.name, 'list_tasks')
})

test('listTasksTool: schema does not expose userId or characterId', () => {
  const db = makeMockDb()
  const tool = listTasksTool(db, 'user-1', 'char-1')
  const decl = tool._getDeclaration()
  const props = decl.parameters?.properties ?? {}
  assert.ok(!('userId' in props))
  assert.ok(!('characterId' in props))
})

test('listTasksTool: returns serialised task rows', async () => {
  const rows = [
    { id: 't-1', characterId: 'char-1', userId: 'user-1', title: 'Task one', status: 'open', createdAt: new Date(), updatedAt: new Date() },
  ]
  const db = makeMockDb(rows as InsertedRow[])
  const tool = listTasksTool(db, 'user-1', 'char-1')
  const result = await (tool as unknown as { execute: (args: unknown) => Promise<string> })
    .execute({})
  const parsed = JSON.parse(result) as typeof rows
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0]!.title, 'Task one')
})

// Mutation tool tests — use a separate db mock that supports update/delete
function makeMutationDb() {
  const updates: Record<string, unknown>[] = []
  return {
    _updates: updates,
    update: (_table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          updates.push(values)
          return Promise.resolve()
        },
      }),
    }),
    delete: (_table: unknown) => ({
      where: () => {
        updates.push({ _deleted: true })
        return Promise.resolve()
      },
    }),
  }
}

const { updateTaskTool, completeTaskTool, deleteTaskTool } = await import('./tasks.js')

test('updateTaskTool: name is update_task', () => {
  const db = makeMutationDb()
  const tool = updateTaskTool(db as unknown as DrizzleClient, 'user-1', 'char-1')
  assert.equal(tool.name, 'update_task')
})

test('updateTaskTool: schema has taskId and title but not userId', () => {
  const db = makeMutationDb()
  const tool = updateTaskTool(db as unknown as DrizzleClient, 'user-1', 'char-1')
  const props = tool._getDeclaration().parameters?.properties ?? {}
  assert.ok('taskId' in props)
  assert.ok('title' in props)
  assert.ok(!('userId' in props))
})

test('updateTaskTool: returns success string', async () => {
  const db = makeMutationDb()
  const tool = updateTaskTool(db as unknown as DrizzleClient, 'user-1', 'char-1')
  const result = await (tool as unknown as { execute: (a: unknown) => Promise<string> })
    .execute({ taskId: 't-1', title: 'New title' })
  assert.equal(result, 'Task updated.')
})

test('completeTaskTool: name is complete_task', () => {
  const db = makeMutationDb()
  const tool = completeTaskTool(db as unknown as DrizzleClient, 'user-1', 'char-1')
  assert.equal(tool.name, 'complete_task')
})

test('completeTaskTool: returns success string', async () => {
  const db = makeMutationDb()
  const tool = completeTaskTool(db as unknown as DrizzleClient, 'user-1', 'char-1')
  const result = await (tool as unknown as { execute: (a: unknown) => Promise<string> })
    .execute({ taskId: 't-1' })
  assert.equal(result, 'Task marked as completed.')
})

test('deleteTaskTool: name is delete_task', () => {
  const db = makeMutationDb()
  const tool = deleteTaskTool(db as unknown as DrizzleClient, 'user-1', 'char-1')
  assert.equal(tool.name, 'delete_task')
})

test('deleteTaskTool: returns success string', async () => {
  const db = makeMutationDb()
  const tool = deleteTaskTool(db as unknown as DrizzleClient, 'user-1', 'char-1')
  const result = await (tool as unknown as { execute: (a: unknown) => Promise<string> })
    .execute({ taskId: 't-1' })
  assert.equal(result, 'Task deleted.')
})
