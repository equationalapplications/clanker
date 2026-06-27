import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer, type Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import type { DrizzleClient } from '../db/client.js'
import { handleWsUpgrade } from './wsAgentHandler.js'

type InsertedRow = Record<string, unknown>

function makeMockDb(queryRowSets: InsertedRow[][] = []) {
  let callIndex = 0
  return {
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

const mockUser = { id: 'user-uuid-1' }
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

const mockCreditService = {
  spendCredit: async (_userId: string): Promise<string> => 'mock-txid',
  refundCredit: async (_userId: string, _txId: string): Promise<void> => {},
  getBalance: async (_userId: string): Promise<number> => 42,
}

function createTestWsServer(handlerOptions: Parameters<typeof handleWsUpgrade>[2]): {
  server: Server
  port: number
  close: () => Promise<void>
} {
  const server = createServer()
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      void handleWsUpgrade(ws, req, handlerOptions)
    })
  })
  return {
    server,
    port: 0,
    close: () => new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
    }),
  }
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') resolve(addr.port)
      else reject(new Error('failed to bind'))
    })
  })
}

test('accepts valid auth token and streams agent reply', async () => {
  const db = makeMockDb([[mockUser], [mockCharacter]])
  const { server, close } = createTestWsServer({
    db,
    creditService: mockCreditService,
    verifyToken: async () => ({ uid: 'firebase-uid' }),
    mockStreamReply: 'Hello from WebSocket',
  })
  const port = await listen(server)

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    let reply = ''
    const timeout = setTimeout(() => reject(new Error('test timeout')), 5000)

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'valid-token' }))
      ws.send(JSON.stringify({
        type: 'agent_run',
        message: 'hello',
        characterId: CHAR_UUID,
      }))
    })

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as { type: string; text?: string }
      if (msg.type === 'token' && msg.text) reply += msg.text
      if (msg.type === 'usage_snapshot') {
        clearTimeout(timeout)
        assert.equal(reply, 'Hello from WebSocket')
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

test('streams grounding_metadata before usage_snapshot when mock grounding is provided', async () => {
  const groundingMetadata = {
    webSearchQueries: ['weather in Tokyo'],
    groundingChunks: [{ web: { uri: 'https://example.com', title: 'Example' } }],
    searchEntryPoint: { renderedContent: '<div>suggestions</div>' },
  }
  const db = makeMockDb([[mockUser], [mockCharacter]])
  const { server, close } = createTestWsServer({
    db,
    creditService: mockCreditService,
    verifyToken: async () => ({ uid: 'firebase-uid' }),
    mockStreamReply: 'Hello from WebSocket',
    mockGroundingMetadata: groundingMetadata,
  })
  const port = await listen(server)

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    let reply = ''
    let sawGrounding = false
    const timeout = setTimeout(() => reject(new Error('test timeout')), 5000)

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'valid-token' }))
      ws.send(JSON.stringify({
        type: 'agent_run',
        message: 'hello',
        characterId: CHAR_UUID,
      }))
    })

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as {
        type: string
        text?: string
        groundingMetadata?: typeof groundingMetadata
      }
      if (msg.type === 'token' && msg.text) reply += msg.text
      if (msg.type === 'grounding_metadata') {
        sawGrounding = true
        assert.deepEqual(msg.groundingMetadata, groundingMetadata)
      }
      if (msg.type === 'usage_snapshot') {
        clearTimeout(timeout)
        assert.equal(reply, 'Hello from WebSocket')
        assert.equal(sawGrounding, true)
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

test('rejects invalid token with 4001 close code', async () => {
  const db = makeMockDb()
  const { server, close } = createTestWsServer({
    db,
    verifyToken: async () => { throw new Error('Invalid token') },
  })
  const port = await listen(server)

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const timeout = setTimeout(() => reject(new Error('test timeout')), 5000)

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'bad-token' }))
    })

    ws.on('close', (code) => {
      clearTimeout(timeout)
      assert.equal(code, 4001)
      resolve()
    })

    ws.on('error', reject)
  })

  await close()
})

test('times out if auth message not sent within 5 seconds', { timeout: 10_000 }, async () => {
  const db = makeMockDb()
  const { server, close } = createTestWsServer({ db })
  const port = await listen(server)

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)

    ws.on('close', (code) => {
      assert.equal(code, 4001)
      resolve()
    })

    ws.on('error', reject)
    setTimeout(() => reject(new Error('auth timeout not fired')), 8000)
  })

  await close()
})

test('returns INSUFFICIENT_CREDITS error when spendCredit fails', async () => {
  const db = makeMockDb([[mockUser], [mockCharacter]])
  const cs = {
    ...mockCreditService,
    spendCredit: async (): Promise<string> => { throw new Error('INSUFFICIENT_CREDITS') },
  }
  const { server, close } = createTestWsServer({
    db,
    creditService: cs,
    verifyToken: async () => ({ uid: 'firebase-uid' }),
  })
  const port = await listen(server)

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const timeout = setTimeout(() => reject(new Error('test timeout')), 5000)

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'valid-token' }))
      ws.send(JSON.stringify({
        type: 'agent_run',
        message: 'hello',
        characterId: CHAR_UUID,
      }))
    })

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as { type: string; code?: string }
      if (msg.type === 'error') {
        clearTimeout(timeout)
        assert.equal(msg.code, 'INSUFFICIENT_CREDITS')
      }
    })

    ws.on('close', (code) => {
      clearTimeout(timeout)
      assert.equal(code, 4402)
      resolve()
    })

    ws.on('error', reject)
  })

  await close()
})
