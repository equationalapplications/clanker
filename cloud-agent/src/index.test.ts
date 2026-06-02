import assert from 'node:assert/strict'
import test from 'node:test'
import request from 'supertest'
import type { DrizzleClient } from './db/client.js'
import type { RunAgentParams } from './index.js'

type InsertedRow = Record<string, unknown>

// Returns different row sets for sequential select().from().where() calls.
function makeMockDb(queryRowSets: InsertedRow[][] = []) {
  const inserted: InsertedRow[] = []
  let callIndex = 0
  const onConflictDoNothing = () => Promise.resolve()
  return {
    _inserted: inserted,
    insert: (_t: unknown) => ({
      values: (rowOrRows: InsertedRow | InsertedRow[]) => {
        if (Array.isArray(rowOrRows)) {
          inserted.push(...rowOrRows)
        } else {
          inserted.push(rowOrRows)
        }
        return { onConflictDoNothing }
      },
      onConflictDoNothing,
    }),
    select: (_fields?: unknown) => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => {
          const rows = queryRowSets[callIndex++] ?? []
          const p = Promise.resolve(rows)
          return Object.assign(p, {
            limit: (_n: unknown) => Promise.resolve(rows),
            orderBy: (_ord: unknown) => Promise.resolve(rows),
          })
        },
      }),
    }),
  } as unknown as DrizzleClient & { _inserted: InsertedRow[] }
}

const mockUser = {
  id: 'user-uuid-1',
  firebaseUid: 'user-1',
  email: 'test@example.com',
  displayName: 'Test User',
  createdAt: new Date(),
  updatedAt: new Date(),
}

const mockCharacter = {
  id: 'char-1', userId: 'user-uuid-1', name: 'Alice',
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

// ── CORS headers (regression) ────────────────────────────────────────────────

test('health endpoint sends Access-Control-Allow-Origin header', async () => {
  const db = makeMockDb()
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent })
  const res = await request(app).get('/health').set('Origin', 'https://example.com')
  assert.equal(res.status, 200)
  // With CORS_ORIGIN unset, corsOrigins returns '*' so any origin is allowed.
  assert.equal(res.headers['access-control-allow-origin'], '*')
})

test('POST /agent/run sends Access-Control-Allow-Origin on CORS preflight', async () => {
  const db = makeMockDb()
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent })
  const res = await request(app)
    .options('/agent/run')
    .set('Origin', 'https://example.com')
    .set('Access-Control-Request-Method', 'POST')
  assert.equal(res.status, 204)
  assert.equal(res.headers['access-control-allow-origin'], '*')
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

test('POST /agent/run passes DB user UUID (not Firebase UID) to runAgentFn', async () => {
  // Query order: [user lookup, character lookup, wiki context]
  const db = makeMockDb([[mockUser] as InsertedRow[], [mockCharacter] as InsertedRow[], []])
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
  assert.equal(capturedUserId, mockUser.id)
})

test('POST /agent/run returns reply from runAgentFn', async () => {
  const db = makeMockDb([[mockUser] as InsertedRow[], [mockCharacter] as InsertedRow[], []])
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent })
  const res = await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({ message: 'hello', characterId: 'char-1' })
  assert.equal(res.status, 200)
  assert.equal((res.body as { reply: string }).reply, 'Hello from mock agent')
})

test('POST /agent/run returns 404 when character not found for this user', async () => {
  // User found, but character not found (or belongs to another user)
  const db = makeMockDb([[mockUser] as InsertedRow[], []])
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent })
  const res = await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({ message: 'hello', characterId: 'char-missing' })
  assert.equal(res.status, 404)
})

test('POST /agent/run returns 401 when Firebase UID has no DB user record', async () => {
  const db = makeMockDb([[]])
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent })
  const res = await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({ message: 'hello', characterId: 'char-1' })
  assert.equal(res.status, 401)
})

test('POST /agent/run bulk-inserts unsyncedHistory tasks with DB user UUID', async () => {
  const db = makeMockDb([[mockUser] as InsertedRow[], [mockCharacter] as InsertedRow[], []])
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
  assert.equal(taskRow!['userId'], mockUser.id)
  assert.equal(taskRow!['characterId'], 'char-1')
})

test('POST /agent/run maps pending status to open during sync', async () => {
  const db = makeMockDb([[mockUser] as InsertedRow[], [mockCharacter] as InsertedRow[], []])
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent })
  await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({
      message: 'hello',
      characterId: 'char-1',
      unsyncedHistory: [
        { type: 'task', id: 'task-2', title: 'Old task', status: 'pending', createdAt: 1700000000 },
      ],
    })
  const inserted = (db as unknown as { _inserted: InsertedRow[] })._inserted
  const taskRow = inserted.find((r) => r['title'] === 'Old task')
  assert.ok(taskRow, 'expected task row to be inserted')
  assert.equal(taskRow!['status'], 'open')
})

test('POST /agent/run returns 500 when runAgentFn throws (ADK error path)', async () => {
  const failingAgent = async (_params: RunAgentParams): Promise<{ reply: string; toolCalls: string[] }> => {
    throw new Error('ADK error (unknown): something went wrong')
  }
  const db = makeMockDb([[mockUser] as InsertedRow[], [mockCharacter] as InsertedRow[], []])
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: failingAgent })
  const res = await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({ message: 'hello', characterId: 'char-1' })
  assert.equal(res.status, 500)
  assert.equal((res.body as { error: string }).error, 'Internal server error')
})
