import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer, type Server } from 'node:http'
import { WebSocket } from 'ws'
import request from 'supertest'
import type { DrizzleClient } from './db/client.js'
import type { RunAgentParams } from './index.js'

type InsertedRow = Record<string, unknown>

function makeMockDb(queryRowSets: InsertedRow[][] = []) {
  let callIndex = 0
  const onConflictDoNothing = () => Promise.resolve()
  return {
    insert: (_t: unknown) => ({
      values: (_rowOrRows: unknown) => ({ onConflictDoNothing }),
      onConflictDoNothing,
    }),
    select: (_fields?: unknown) => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => {
          if (callIndex >= queryRowSets.length) callIndex = 0
          const rows = queryRowSets[callIndex++] ?? []
          const p = Promise.resolve(rows)
          return Object.assign(p, {
            limit: (_n: unknown) => Promise.resolve(rows),
            orderBy: (_ord: unknown) => Promise.resolve(rows),
          })
        },
      }),
    }),
  } as unknown as DrizzleClient
}

const mockUser = { id: 'user-uuid-1', firebaseUid: 'user-1' }
const mockCharacter = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  userId: 'user-uuid-1',
  name: 'Alice',
  appearance: null,
  traits: null,
  emotions: null,
  context: null,
}
const CHAR_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const mockVerify = async (token: string): Promise<{ uid: string }> => {
  if (token === 'valid-token') return { uid: 'user-1' }
  throw new Error('invalid')
}

const mockRunAgent = async (_params: RunAgentParams): Promise<{ reply: string; toolCalls: string[] }> => ({
  reply: 'Test reply from agent',
  toolCalls: [],
})

const mockCreditService = {
  spendCredit: async (_userId: string): Promise<string> => 'mock-txid',
  refundCredit: async (_userId: string, _txId: string): Promise<void> => {},
  getBalance: async (_userId: string): Promise<number> => 42,
}

const { createApp, attachAgentStreamWebSocket } = await import('./index.js')

function startServer(app: ReturnType<typeof createApp>, wsOptions?: { mockStreamReply?: string }): Promise<{
  server: Server
  port: number
  close: () => Promise<void>
}> {
  const db = makeMockDb([[mockUser], [mockCharacter], []])
  return new Promise((resolve, reject) => {
    const server = createServer(app)
    attachAgentStreamWebSocket(server, {
      verifyToken: mockVerify,
      db,
      runAgentFn: mockRunAgent,
      creditService: mockCreditService,
      wsHandlerOptions: wsOptions,
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr !== 'object') {
        reject(new Error('failed to bind'))
        return
      }
      resolve({
        server,
        port: addr.port,
        close: () => new Promise((res, rej) => server.close((err) => (err ? rej(err) : res()))),
      })
    })
  })
}

test('HTTP /agent/run returns reply', async () => {
  const db = makeMockDb([[mockUser], [mockCharacter], []])
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent, creditService: mockCreditService })
  const res = await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({ message: 'Hello', characterId: CHAR_UUID })
  assert.equal(res.status, 200)
  assert.equal((res.body as { reply: string }).reply, 'Test reply from agent')
})

test('WebSocket /agent/stream returns reply via streaming', async () => {
  const db = makeMockDb([[mockUser], [mockCharacter], []])
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent, creditService: mockCreditService })
  const { port, close } = await startServer(app, { mockStreamReply: 'Test reply from agent' })

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/agent/stream`)
    let reply = ''
    const timeout = setTimeout(() => reject(new Error('test timeout')), 5000)

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'valid-token' }))
      ws.send(JSON.stringify({
        type: 'agent_run',
        message: 'Hello',
        characterId: CHAR_UUID,
      }))
    })

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as { type: string; text?: string }
      if (msg.type === 'token' && msg.text) reply += msg.text
      if (msg.type === 'usage_snapshot') {
        clearTimeout(timeout)
        assert.ok(reply.length > 0)
        ws.close()
      }
    })

    ws.on('close', () => {
      clearTimeout(timeout)
      resolve()
    })

    ws.on('error', reject)
  })

  await close()
})
