import assert from 'node:assert/strict'
import test from 'node:test'
import http from 'node:http'
import request from 'supertest'
import { InMemoryRunner } from '@google/adk'
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
    execute: async (_query: unknown) => ({ rows: [{ id: 'mock-txid', total: '99' }] }),
    transaction: async (callback: (tx: DrizzleClient) => Promise<unknown>) => {
      const tx = {
        execute: async (_query: unknown) => ({ rows: [{ id: 'mock-txid', total: '99' }] }),
      }
      return await callback(tx as unknown as DrizzleClient)
    },
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
          let rows: InsertedRow[]
          if (queryRowSets.length > 0) {
            if (callIndex >= queryRowSets.length) callIndex = 0
            rows = queryRowSets[callIndex++] ?? []
          } else {
            const phase = callIndex % 4
            callIndex++
            rows = phase === 1 ? [mockCharacter] : phase === 0 ? [mockUser] : []
          }
          const p = Promise.resolve(rows)
          const withLimit = Object.assign(p, {
            limit: (_n: unknown) => Promise.resolve(rows),
          })
          return Object.assign(withLimit, {
            orderBy: (_ord: unknown) => withLimit,
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
  id: 'char-1',
  userId: 'user-uuid-1',
  name: 'Alice',
  appearance: null,
  traits: null,
  emotions: null,
  context: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

const mockVerify = async (token: string): Promise<{ uid: string }> => {
  if (token === 'valid-token') return { uid: 'user-1' }
  throw new Error('invalid')
}

const mockRunAgent = async (
  _params: RunAgentParams,
): Promise<{ reply: string; toolCalls: string[] }> => ({
  reply: 'Hello from mock agent',
  toolCalls: [],
})

const mockCreditService = {
  spendCredit: async (_userId: string): Promise<{ transactionId: string; amount: number }[]> => [
    { transactionId: 'mock-txid', amount: 1 },
  ],
  refundCredit: async (
    _userId: string,
    _allocations: { transactionId: string; amount: number }[],
  ): Promise<void> => {},
  getBalance: async (_userId: string): Promise<number> => 1000,
}

const CHAR_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const MISSING_CHAR_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const { createApp, attachWebSocketRoutes, runAgentReal } = await import('./index.js')

/** Boots the real app + real upgrade handler on an ephemeral port. */
async function startWsTestServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const db = makeMockDb()
  const appOptions = {
    verifyToken: mockVerify,
    db,
    runAgentFn: mockRunAgent,
    creditService: mockCreditService,
  }
  const server = createApp(appOptions).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  attachWebSocketRoutes(server, appOptions)
  const port = (server.address() as { port: number }).port
  return {
    port,
    close: async () => {
      // Upgraded sockets stay tracked by the http server; without this,
      // server.close() waits on them forever and the test times out.
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      })
    },
  }
}

type UpgradeResult = { upgraded: true } | { upgraded: false; statusCode: number }

/** Issues a raw WebSocket upgrade and reports only whether it was accepted. */
async function attemptUpgrade(
  port: number,
  origin?: string,
  forwardedProto?: 'http' | 'https',
): Promise<UpgradeResult> {
  const headers: Record<string, string> = {
    Connection: 'Upgrade',
    Upgrade: 'websocket',
    'Sec-WebSocket-Version': '13',
    'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
  }
  if (origin !== undefined) headers.Origin = origin
  // Simulates a TLS-terminating proxy hop (Cloud Run LB) by advertising the
  // public scheme on the wire while leaving the local connection plain HTTP.
  if (forwardedProto !== undefined) headers['X-Forwarded-Proto'] = forwardedProto

  return await new Promise<UpgradeResult>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/agent/stream', headers })
    const timer = setTimeout(() => {
      req.destroy()
      reject(new Error('upgrade attempt timed out'))
    }, 5000)
    req.on('upgrade', (_res, socket) => {
      clearTimeout(timer)
      socket.destroy()
      resolve({ upgraded: true })
    })
    req.on('response', (res) => {
      clearTimeout(timer)
      res.resume()
      resolve({ upgraded: false, statusCode: res.statusCode ?? 0 })
    })
    req.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    req.end()
  })
}

// ── /health ──────────────────────────────────────────────────────────────────

test('GET /health returns 200 without auth', async () => {
  const db = makeMockDb()
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent })
  const res = await request(app).get('/health')
  assert.equal(res.status, 200)
  assert.deepEqual(res.body, { status: 'ok' })
})

// ── CORS headers (regression) ────────────────────────────────────────────────

test('health endpoint sends Access-Control-Allow-Origin header when CORS_ORIGIN is set', async () => {
  const orig = process.env.CORS_ORIGIN
  process.env.CORS_ORIGIN = 'https://example.com'
  const db = makeMockDb()
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent })
  const res = await request(app).get('/health').set('Origin', 'https://example.com')
  assert.equal(res.status, 200)
  assert.equal(res.headers['access-control-allow-origin'], 'https://example.com')
  if (orig !== undefined) process.env.CORS_ORIGIN = orig
  else delete process.env.CORS_ORIGIN
})

test('health endpoint allows an explicitly configured Chrome extension origin', async () => {
  const orig = process.env.CORS_ORIGIN
  const extensionOrigin = 'chrome-extension://abcdefghijklmnop'
  process.env.CORS_ORIGIN = extensionOrigin
  try {
    const db = makeMockDb()
    const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent })
    const res = await request(app).get('/health').set('Origin', extensionOrigin)
    assert.equal(res.status, 200)
    assert.equal(res.headers['access-control-allow-origin'], extensionOrigin)
  } finally {
    if (orig !== undefined) process.env.CORS_ORIGIN = orig
    else delete process.env.CORS_ORIGIN
  }
})

test('POST /agent/run sends Access-Control-Allow-Origin on CORS preflight when CORS_ORIGIN is set', async () => {
  const orig = process.env.CORS_ORIGIN
  process.env.CORS_ORIGIN = 'https://example.com'
  const db = makeMockDb()
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent })
  const res = await request(app)
    .options('/agent/run')
    .set('Origin', 'https://example.com')
    .set('Access-Control-Request-Method', 'POST')
  assert.equal(res.status, 204)
  assert.equal(res.headers['access-control-allow-origin'], 'https://example.com')
  if (orig !== undefined) process.env.CORS_ORIGIN = orig
  else delete process.env.CORS_ORIGIN
})

test('health endpoint blocks all origins when CORS_ORIGIN is set to wildcard (wildcard disallowed)', async () => {
  const orig = process.env.CORS_ORIGIN
  process.env.CORS_ORIGIN = '*'
  const db = makeMockDb()
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent })
  const res = await request(app).get('/health').set('Origin', 'https://anything.example.com')
  assert.equal(res.status, 200)
  assert.equal(res.headers['access-control-allow-origin'], undefined)
  if (orig !== undefined) process.env.CORS_ORIGIN = orig
  else delete process.env.CORS_ORIGIN
})

// ── CORS default (no CORS_ORIGIN) ────────────────────────────────────────────

test('health endpoint blocks all origins when CORS_ORIGIN is not set', async () => {
  const orig = process.env.CORS_ORIGIN
  delete process.env.CORS_ORIGIN
  try {
    const db = makeMockDb()
    const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent })
    const res = await request(app).get('/health').set('Origin', 'https://example.com')
    assert.equal(res.status, 200)
    assert.equal(res.headers['access-control-allow-origin'], undefined)
  } finally {
    if (orig !== undefined) process.env.CORS_ORIGIN = orig
  }
})

// ── Auth middleware ───────────────────────────────────────────────────────────

test('POST /agent/run returns 401 with no Authorization header', async () => {
  const db = makeMockDb()
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent })
  const res = await request(app).post('/agent/run').send({ message: 'hi', characterId: CHAR_UUID })
  assert.equal(res.status, 401)
  assert.equal((res.body as { error: string }).error, 'Unauthorized')
})

test('POST /agent/run returns 401 with invalid token', async () => {
  const db = makeMockDb()
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent })
  const res = await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer bad-token')
    .send({ message: 'hi', characterId: CHAR_UUID })
  assert.equal(res.status, 401)
})

// ── /agent/run ────────────────────────────────────────────────────────────────

test('POST /agent/run returns 400 when characterId is not a valid UUID', async () => {
  const db = makeMockDb([[mockUser] as InsertedRow[]])
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent })
  const res = await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({ message: 'hello', characterId: 'not-a-uuid' })
  assert.equal(res.status, 400)
})

test('POST /agent/run passes DB user UUID and Firebase UID to runAgentFn', async () => {
  // Query order: [user lookup, character lookup, wiki context]
  const db = makeMockDb([[mockUser] as InsertedRow[], [mockCharacter] as InsertedRow[], []])
  let capturedUserId = ''
  let capturedFirebaseUid = ''
  const app = createApp({
    verifyToken: mockVerify,
    db,
    runAgentFn: async (params) => {
      capturedUserId = params.userId
      capturedFirebaseUid = params.firebaseUid
      return { reply: 'ok', toolCalls: [] }
    },
    creditService: mockCreditService,
  })
  await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({ message: 'hello', characterId: CHAR_UUID })
  assert.equal(capturedUserId, mockUser.id)
  assert.equal(capturedFirebaseUid, mockUser.firebaseUid)
})

test('POST /agent/run returns reply from runAgentFn', async () => {
  const db = makeMockDb([[mockUser] as InsertedRow[], [mockCharacter] as InsertedRow[], []])
  const app = createApp({
    verifyToken: mockVerify,
    db,
    runAgentFn: mockRunAgent,
    creditService: mockCreditService,
  })
  const res = await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({ message: 'hello', characterId: CHAR_UUID })
  assert.equal(res.status, 200)
  assert.equal((res.body as { reply: string }).reply, 'Hello from mock agent')
})

test('POST /agent/run returns generatedImage when runAgentFn produced one', async () => {
  const db = makeMockDb([[mockUser] as InsertedRow[], [mockCharacter] as InsertedRow[], []])
  const app = createApp({
    verifyToken: mockVerify,
    db,
    runAgentFn: async () => ({
      reply: 'here is your chart',
      toolCalls: ['generate_image'],
      generatedImage: { imageBase64: 'QUJD', mimeType: 'image/png' },
    }),
    creditService: mockCreditService,
  })
  const res = await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({ message: 'hello', characterId: CHAR_UUID })
  assert.equal(res.status, 200)
  assert.deepEqual((res.body as { generatedImage: unknown }).generatedImage, {
    imageBase64: 'QUJD',
    mimeType: 'image/png',
  })
})

test('POST /agent/run returns generatedImage null when nothing was generated', async () => {
  const db = makeMockDb([[mockUser] as InsertedRow[], [mockCharacter] as InsertedRow[], []])
  const app = createApp({
    verifyToken: mockVerify,
    db,
    runAgentFn: async () => ({ reply: 'plain text', toolCalls: [] }),
    creditService: mockCreditService,
  })
  const res = await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({ message: 'hello', characterId: CHAR_UUID })
  assert.equal(res.status, 200)
  assert.equal((res.body as { generatedImage: unknown }).generatedImage, null)
})

test('POST /agent/run returns 404 when character not found for this user', async () => {
  // User found, but character not found (or belongs to another user)
  const db = makeMockDb([[mockUser] as InsertedRow[], []])
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent })
  const res = await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({ message: 'hello', characterId: MISSING_CHAR_UUID })
  assert.equal(res.status, 404)
})

test('POST /agent/run returns 401 when Firebase UID has no DB user record', async () => {
  const db = makeMockDb([[]])
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent })
  const res = await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({ message: 'hello', characterId: CHAR_UUID })
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
      characterId: CHAR_UUID,
      unsyncedHistory: [
        { type: 'task', id: 'task-1', title: 'Buy milk', status: 'open', createdAt: 1700000000 },
      ],
    })
  const inserted = (db as unknown as { _inserted: InsertedRow[] })._inserted
  const taskRow = inserted.find((r) => r['title'] === 'Buy milk')
  assert.ok(taskRow, 'expected task row to be inserted')
  assert.equal(taskRow!['userId'], mockUser.id)
  assert.equal(taskRow!['characterId'], CHAR_UUID)
})

test('POST /agent/run maps pending status to open during sync', async () => {
  const db = makeMockDb([[mockUser] as InsertedRow[], [mockCharacter] as InsertedRow[], []])
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent })
  await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({
      message: 'hello',
      characterId: CHAR_UUID,
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
  const failingAgent = async (
    _params: RunAgentParams,
  ): Promise<{ reply: string; toolCalls: string[] }> => {
    throw new Error('ADK error (unknown): something went wrong')
  }
  const db = makeMockDb([[mockUser] as InsertedRow[], [mockCharacter] as InsertedRow[], []])
  const app = createApp({
    verifyToken: mockVerify,
    db,
    runAgentFn: failingAgent,
    creditService: mockCreditService,
  })
  const res = await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({ message: 'hello', characterId: CHAR_UUID })
  assert.equal(res.status, 500)
  // K_SERVICE is not set and NODE_ENV is 'test', so real error leaks for debugging
  assert.match((res.body as { error: string }).error, /ADK error/)
})

// ── Rate limiter ──────────────────────────────────────────────────────────────

test('POST /agent/run rate-limits after 20 requests in 60s window', async () => {
  // Cycle user → character → wiki rows per request (queryWikiContext adds a 3rd select).
  const db = makeMockDb([[mockUser] as InsertedRow[], [mockCharacter] as InsertedRow[], []])
  const app = createApp({
    verifyToken: mockVerify,
    db,
    runAgentFn: mockRunAgent,
    creditService: mockCreditService,
  })
  for (let i = 0; i < 20; i++) {
    const res = await request(app)
      .post('/agent/run')
      .set('Authorization', 'Bearer valid-token')
      .send({ message: 'hello', characterId: CHAR_UUID })
    assert.equal(res.status, 200, `request ${i + 1} should succeed`)
  }
  const res = await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({ message: 'hello', characterId: CHAR_UUID })
  assert.equal(res.status, 429)
  assert.equal((res.body as { error: string }).error, 'Too many requests. Please try again later.')
})

// ── Credit service integration ────────────────────────────────────────────────

test('POST /agent/run returns 402 when balance is zero before agent starts', async () => {
  const db = makeMockDb([[mockUser] as InsertedRow[], [mockCharacter] as InsertedRow[], []])
  const cs = {
    ...mockCreditService,
    getBalance: async (_userId: string) => 0,
  }
  let agentCalled = false
  const app = createApp({
    verifyToken: mockVerify,
    db,
    runAgentFn: async () => {
      agentCalled = true
      return { reply: 'ok', toolCalls: [] }
    },
    creditService: cs,
  })
  const res = await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({ message: 'hello', characterId: CHAR_UUID })
  assert.equal(res.status, 402)
  assert.deepEqual(res.body, { error: 'Insufficient credits' })
  assert.ok(!agentCalled, 'runAgentFn must not be called when balance is zero')
})

test('POST /agent/run returns usageSnapshot.remainingCredits on success', async () => {
  const db = makeMockDb([[mockUser] as InsertedRow[], [mockCharacter] as InsertedRow[], []])
  const cs = { ...mockCreditService, getBalance: async (_userId: string) => 2700 }
  const app = createApp({
    verifyToken: mockVerify,
    db,
    runAgentFn: mockRunAgent,
    creditService: cs,
  })
  const res = await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({ message: 'hello', characterId: CHAR_UUID })
  assert.equal(res.status, 200)
  assert.deepEqual((res.body as { usageSnapshot: unknown }).usageSnapshot, {
    remainingCredits: 2700,
  })
})

test('POST /agent/run returns usageSnapshot: null and 200 when getBalance throws', async () => {
  const db = makeMockDb([[mockUser] as InsertedRow[], [mockCharacter] as InsertedRow[], []])
  const cs = {
    ...mockCreditService,
    getBalance: async (_userId: string): Promise<number> => {
      throw new Error('db connection lost')
    },
  }
  const app = createApp({
    verifyToken: mockVerify,
    db,
    runAgentFn: mockRunAgent,
    creditService: cs,
  })
  const res = await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({ message: 'hello', characterId: CHAR_UUID })
  assert.equal(res.status, 200)
  assert.equal((res.body as { usageSnapshot: unknown }).usageSnapshot, null)
})

test('POST /agent/run captures X-Timezone header and passes it to runAgentFn', async () => {
  const db = makeMockDb([[mockUser] as InsertedRow[], [mockCharacter] as InsertedRow[], []])
  let capturedTimezone = ''
  const app = createApp({
    verifyToken: mockVerify,
    db,
    runAgentFn: async (params) => {
      capturedTimezone = params.timezone
      return { reply: 'ok', toolCalls: [] }
    },
    creditService: mockCreditService,
  })
  await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .set('X-Timezone', 'America/Chicago')
    .send({ message: 'hello', characterId: CHAR_UUID })
  assert.equal(capturedTimezone, 'America/Chicago')
})

// ── Shared /agent/run contract (Phase 2 vision/chat-uploads) ────────────────

async function runAgentRunRequest(options: {
  body: Record<string, unknown>
  onNewMessage?: (newMessage: unknown) => void
}) {
  const db = makeMockDb([[mockUser] as InsertedRow[], [mockCharacter] as InsertedRow[], []])

  const originalRunAsync = InMemoryRunner.prototype.runAsync
  ;(
    InMemoryRunner.prototype as unknown as {
      runAsync: (params: { newMessage: unknown }) => AsyncGenerator<unknown, void, undefined>
    }
  ).runAsync = function runAsyncMock(params: { newMessage: unknown }) {
    options.onNewMessage?.(params.newMessage)
    return (async function* () {
      yield {
        id: 'mock-event-1',
        invocationId: 'mock-invocation-1',
        author: 'mock-agent',
        actions: { stateDelta: {}, artifactDelta: {} },
        timestamp: Date.now(),
        content: { role: 'model', parts: [{ text: 'mock reply' }] },
      }
    })()
  }

  const app = createApp({
    verifyToken: mockVerify,
    db,
    runAgentFn: runAgentReal,
    creditService: mockCreditService,
  })

  try {
    return await request(app)
      .post('/agent/run')
      .set('Authorization', 'Bearer valid-token')
      .send(options.body)
  } finally {
    ;(InMemoryRunner.prototype as unknown as { runAsync: typeof originalRunAsync }).runAsync =
      originalRunAsync
  }
}

test('POST /agent/run forwards an attachment as a leading inlineData part', async () => {
  const captured: unknown[] = []
  const res = await runAgentRunRequest({
    body: {
      message: 'what is this?',
      characterId: CHAR_UUID,
      attachments: [{ mimeType: 'image/webp', data: 'AAAA' }],
    },
    onNewMessage: (newMessage) => captured.push(newMessage),
  })

  assert.equal(res.status, 200)
  assert.deepEqual(captured[0], {
    role: 'user',
    parts: [{ inlineData: { mimeType: 'image/webp', data: 'AAAA' } }, { text: 'what is this?' }],
  })
})

test('POST /agent/run accepts a captionless photo and rejects an empty turn', async () => {
  const withPhoto = await runAgentRunRequest({
    body: {
      message: '',
      characterId: CHAR_UUID,
      attachments: [{ mimeType: 'image/webp', data: 'AAAA' }],
    },
  })
  assert.equal(withPhoto.status, 200)

  // Empty turn (no message, no attachments) must short-circuit at the schema.
  const db = makeMockDb()
  const app = createApp({
    verifyToken: mockVerify,
    db,
    runAgentFn: async () => ({ reply: 'never called', toolCalls: [] }),
    creditService: mockCreditService,
  })
  const empty = await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({ message: '', characterId: CHAR_UUID })
  assert.equal(empty.status, 400)
})

test('POST /agent/browser/scheduler-trigger returns 401 with no secret', async () => {
  const savedSecret = process.env.SCHEDULER_SECRET
  process.env.SCHEDULER_SECRET = 'test-scheduler-secret-for-index'
  try {
    const db = makeMockDb()
    const app = createApp({
      verifyToken: async () => ({ uid: 'uid' }),
      db,
      runAgentFn: async () => ({ reply: 'ok', toolCalls: [] }),
    })
    const res = await request(app)
      .post('/agent/browser/scheduler-trigger')
      .send({
        uid: 'u1',
        action: { type: 'extract', selector: '.p', label: 'p' },
        actionSummary: 'Extract',
        notificationBody: 'Done',
      })
    assert.equal(res.status, 401)
  } finally {
    if (savedSecret === undefined) delete process.env.SCHEDULER_SECRET
    else process.env.SCHEDULER_SECRET = savedSecret
  }
})

test('POST /agent/browser/scheduler-trigger returns 503 when SCHEDULER_SECRET not set', async () => {
  const saved = process.env.SCHEDULER_SECRET
  delete process.env.SCHEDULER_SECRET
  try {
    const db = makeMockDb()
    const app = createApp({
      verifyToken: async () => ({ uid: 'uid' }),
      db,
      runAgentFn: async () => ({ reply: 'ok', toolCalls: [] }),
    })
    const res = await request(app)
      .post('/agent/browser/scheduler-trigger')
      .set('Authorization', 'Bearer anything')
      .send({
        uid: 'u1',
        action: { type: 'extract', selector: '.p', label: 'p' },
        actionSummary: 'Extract',
        notificationBody: 'Done',
      })
    assert.equal(res.status, 503)
  } finally {
    if (saved === undefined) delete process.env.SCHEDULER_SECRET
    else process.env.SCHEDULER_SECRET = saved
  }
})

// ── WebSocket upgrade origin verification ────────────────────────────────────

test('WS upgrade with no Origin header succeeds (server-to-server caller)', async () => {
  const orig = process.env.CORS_ORIGIN
  delete process.env.CORS_ORIGIN
  const srv = await startWsTestServer()
  try {
    const result = await attemptUpgrade(srv.port)
    assert.deepEqual(result, { upgraded: true })
  } finally {
    await srv.close()
    if (orig !== undefined) process.env.CORS_ORIGIN = orig
  }
})

test("WS upgrade with the cloud-agent's own origin succeeds (React Native client path)", async () => {
  // React Native 0.86.2's Android WebSocketModule synthesizes
  // `Origin: http(s)://<endpoint>` when the JS client does not supply one
  // (see `node_modules/react-native/.../WebSocketModule.kt` `getDefaultOrigin`).
  // The test server binds to 127.0.0.1; the synthesized origin must be
  // accepted without any CORS_ORIGIN configuration.
  const orig = process.env.CORS_ORIGIN
  delete process.env.CORS_ORIGIN
  const srv = await startWsTestServer()
  try {
    const result = await attemptUpgrade(srv.port, `http://127.0.0.1:${srv.port}`)
    assert.deepEqual(result, { upgraded: true })
  } finally {
    await srv.close()
    if (orig !== undefined) process.env.CORS_ORIGIN = orig
  }
})

test("WS upgrade with the cloud-agent's own https origin succeeds behind a TLS-terminating proxy (Cloud Run shape)", async () => {
  // Cloud Run terminates TLS at the managed LB, so inside the container
  // `req.socket.encrypted` is false even though the client connected via
  // wss:// and synthesized `Origin: https://<host>`. The server must consult
  // X-Forwarded-Proto to recognize its own https origin, otherwise native
  // clients get a 403 on every /agent/stream and /agent/live upgrade.
  const orig = process.env.CORS_ORIGIN
  delete process.env.CORS_ORIGIN
  let srv: Awaited<ReturnType<typeof startWsTestServer>> | undefined
  try {
    srv = await startWsTestServer()
    const result = await attemptUpgrade(srv.port, `https://127.0.0.1:${srv.port}`, 'https')
    assert.deepEqual(result, { upgraded: true })
  } finally {
    try {
      if (srv) await srv.close()
    } finally {
      if (orig === undefined) delete process.env.CORS_ORIGIN
      else process.env.CORS_ORIGIN = orig
    }
  }
})

test('WS upgrade with an Origin is rejected with 403 when CORS_ORIGIN is not set', async () => {
  const orig = process.env.CORS_ORIGIN
  delete process.env.CORS_ORIGIN
  const srv = await startWsTestServer()
  try {
    const result = await attemptUpgrade(srv.port, 'https://evil.example.com')
    assert.deepEqual(result, { upgraded: false, statusCode: 403 })
  } finally {
    await srv.close()
    if (orig !== undefined) process.env.CORS_ORIGIN = orig
  }
})

test('WS upgrade with an allowlisted Origin succeeds', async () => {
  const orig = process.env.CORS_ORIGIN
  process.env.CORS_ORIGIN = 'https://example.com'
  const srv = await startWsTestServer()
  try {
    const result = await attemptUpgrade(srv.port, 'https://example.com')
    assert.deepEqual(result, { upgraded: true })
  } finally {
    await srv.close()
    if (orig !== undefined) process.env.CORS_ORIGIN = orig
    else delete process.env.CORS_ORIGIN
  }
})

test('WS upgrade with an explicitly configured Chrome extension origin succeeds', async () => {
  const orig = process.env.CORS_ORIGIN
  const extensionOrigin = 'chrome-extension://abcdefghijklmnop'
  process.env.CORS_ORIGIN = extensionOrigin
  const srv = await startWsTestServer()
  try {
    const result = await attemptUpgrade(srv.port, extensionOrigin)
    assert.deepEqual(result, { upgraded: true })
  } finally {
    await srv.close()
    if (orig !== undefined) process.env.CORS_ORIGIN = orig
    else delete process.env.CORS_ORIGIN
  }
})

test('WS upgrade with a non-allowlisted Origin is rejected with 403', async () => {
  const orig = process.env.CORS_ORIGIN
  process.env.CORS_ORIGIN = 'https://example.com'
  const srv = await startWsTestServer()
  try {
    const result = await attemptUpgrade(srv.port, 'https://evil.example.com')
    assert.deepEqual(result, { upgraded: false, statusCode: 403 })
  } finally {
    await srv.close()
    if (orig !== undefined) process.env.CORS_ORIGIN = orig
    else delete process.env.CORS_ORIGIN
  }
})

test('runAgentReal refunds a generated image when the loop throws after tool success', async () => {
  const db = makeMockDb([[mockUser] as InsertedRow[], [mockCharacter] as InsertedRow[], []])
  const refunds: {
    userId: string
    allocations: { transactionId: string; amount: number }[]
  }[] = []
  // Distinguish the image spend from the loop's per-iteration spends — only
  // the former belongs to runAgentReal's failure path.
  const cs = {
    spendCredit: async (
      _userId: string,
      amount: number,
      reason: string,
    ): Promise<{ transactionId: string; amount: number }[]> =>
      reason === 'image_generate'
        ? [{ transactionId: 'http-image-txid', amount }]
        : [{ transactionId: 'http-turn-txid', amount }],
    refundCredit: async (
      userId: string,
      allocations: { transactionId: string; amount: number }[],
    ): Promise<void> => {
      refunds.push({ userId, allocations })
    },
    getBalance: async (_userId: string): Promise<number> => 1000,
  }

  const originalRunAsync = InMemoryRunner.prototype.runAsync
  ;(
    InMemoryRunner.prototype as unknown as {
      runAsync: () => AsyncGenerator<unknown, void, undefined>
    }
  ).runAsync = function runAsyncMock(this: unknown) {
    const runner = this as { agent?: { tools?: unknown[] } }
    return (async function* () {
      // Drive the REAL generate_image execute (against the injected fake Vertex
      // generator), then poison the stream so consumeAgentEvents throws.
      const tools = runner.agent?.tools ?? []
      const imageTool = tools.find((t) => (t as { name?: string }).name === 'generate_image') as
        | { execute: (args: unknown) => Promise<string> }
        | undefined
      await imageTool?.execute({ prompt: 'draw a cat' })
      yield {
        id: 'mock-event-fc',
        invocationId: 'mock-invocation-fc',
        author: 'mock-agent',
        actions: { stateDelta: {}, artifactDelta: {} },
        timestamp: Date.now(),
        content: {
          role: 'model',
          parts: [{ functionCall: { name: 'generate_image', args: { prompt: 'draw a cat' } } }],
        },
      }
      yield {
        id: 'mock-event-err',
        invocationId: 'mock-invocation-err',
        author: 'mock-agent',
        actions: { stateDelta: {}, artifactDelta: {} },
        timestamp: Date.now(),
        errorCode: 'ADK_STREAM_ERROR',
        errorMessage: 'mid-stream failure after generation',
      }
    })()
  }

  try {
    await assert.rejects(
      runAgentReal({
        db,
        userId: mockUser.id,
        firebaseUid: 'user-1',
        characterId: CHAR_UUID,
        systemInstruction: 'You are Alice.',
        message: 'draw me a cat',
        history: [],
        timezone: 'UTC',
        embed: async () => new Array(1536).fill(0),
        creditService: cs,
        imageGenerator: async () => ({ imageBase64: 'QUJD', mimeType: 'image/png' }),
      }),
      /ADK error/,
    )
  } finally {
    ;(InMemoryRunner.prototype as unknown as { runAsync: typeof originalRunAsync }).runAsync =
      originalRunAsync
  }

  const imageRefund = refunds.find((r) =>
    r.allocations.some((a) => a.transactionId === 'http-image-txid'),
  )
  assert.ok(imageRefund, 'expected the image spend to be refunded on the failure path')
  assert.deepEqual(imageRefund.allocations, [{ transactionId: 'http-image-txid', amount: 200 }])
  assert.equal(imageRefund.userId, mockUser.id)
})
