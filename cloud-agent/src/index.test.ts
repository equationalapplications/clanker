import assert from 'node:assert/strict'
import test from 'node:test'
import request from 'supertest'
import type { DrizzleClient } from './db/client.js'
import type { RunAgentParams } from './index.js'

type InsertedRow = Record<string, unknown>

function makeMockDb(queryRows: InsertedRow[] = []) {
  const inserted: InsertedRow[] = []
  return {
    _inserted: inserted,
    insert: (_t: unknown) => ({ values: async (row: InsertedRow) => { inserted.push(row) } }),
    select: (_fields?: unknown) => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => {
          const p = Promise.resolve(queryRows)
          return Object.assign(p, {
            limit: (_n: unknown) => Promise.resolve(queryRows),
            orderBy: (_ord: unknown) => Promise.resolve(queryRows),
          })
        },
      }),
    }),
  } as unknown as DrizzleClient & { _inserted: InsertedRow[] }
}

const mockCharacter = {
  id: 'char-1', userId: 'user-1', name: 'Alice',
  appearance: null, traits: null, emotions: null, context: null,
  createdAt: new Date(), updatedAt: new Date(),
}

const mockVerify = async (token: string): Promise<{ uid: string }> => {
  if (token === 'valid-token') return { uid: 'user-1' }
  throw new Error('invalid')
}

const mockRunAgent = async (_params: RunAgentParams): Promise<{ reply: string; toolCalls: string[] }> => ({
  reply: 'Hello from mock agent',
  toolCalls: [],
})

const { createApp } = await import('./index.js')

// ── /health ──────────────────────────────────────────────────────────────────

test('GET /health returns 200 without auth', async () => {
  const db = makeMockDb()
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent })
  const res = await request(app).get('/health')
  assert.equal(res.status, 200)
  assert.deepEqual(res.body, { status: 'ok' })
})

// ── Auth middleware ───────────────────────────────────────────────────────────

test('POST /agent/run returns 401 with no Authorization header', async () => {
  const db = makeMockDb()
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent })
  const res = await request(app).post('/agent/run').send({ message: 'hi', characterId: 'char-1' })
  assert.equal(res.status, 401)
  assert.equal((res.body as { error: string }).error, 'Unauthorized')
})

test('POST /agent/run returns 401 with invalid token', async () => {
  const db = makeMockDb()
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent })
  const res = await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer bad-token')
    .send({ message: 'hi', characterId: 'char-1' })
  assert.equal(res.status, 401)
})

// ── /agent/run ────────────────────────────────────────────────────────────────

test('POST /agent/run passes uid from token to runAgentFn', async () => {
  const db = makeMockDb([mockCharacter] as InsertedRow[])
  let capturedUserId = ''
  const app = createApp({
    verifyToken: mockVerify,
    db,
    runAgentFn: async (params) => { capturedUserId = params.userId; return { reply: 'ok', toolCalls: [] } },
  })
  await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({ message: 'hello', characterId: 'char-1' })
  assert.equal(capturedUserId, 'user-1')
})

test('POST /agent/run returns reply from runAgentFn', async () => {
  const db = makeMockDb([mockCharacter] as InsertedRow[])
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent })
  const res = await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({ message: 'hello', characterId: 'char-1' })
  assert.equal(res.status, 200)
  assert.equal((res.body as { reply: string }).reply, 'Hello from mock agent')
})

test('POST /agent/run returns 404 when character not found', async () => {
  const db = makeMockDb([])
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent })
  const res = await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({ message: 'hello', characterId: 'char-missing' })
  assert.equal(res.status, 404)
})

test('POST /agent/run bulk-inserts unsyncedHistory tasks', async () => {
  const db = makeMockDb([mockCharacter] as InsertedRow[])
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent })
  await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({
      message: 'hello',
      characterId: 'char-1',
      unsyncedHistory: [
        { type: 'task', id: 'task-1', title: 'Buy milk', status: 'open', createdAt: 1700000000 },
      ],
    })
  const inserted = (db as unknown as { _inserted: InsertedRow[] })._inserted
  const taskRow = inserted.find((r) => r['title'] === 'Buy milk')
  assert.ok(taskRow, 'expected task row to be inserted')
  assert.equal(taskRow!['userId'], 'user-1')
  assert.equal(taskRow!['characterId'], 'char-1')
})
