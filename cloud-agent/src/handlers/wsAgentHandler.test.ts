import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer, type Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import type { Content } from '@google/genai'
import { InMemoryRunner } from '@google/adk'
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
  spendCredit: async (_userId: string): Promise<{ transactionId: string; amount: number }[]> => [
    { transactionId: 'mock-txid', amount: 1 },
  ],
  refundCredit: async (
    _userId: string,
    _allocations: { transactionId: string; amount: number }[],
  ): Promise<void> => {},
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
    close: () =>
      new Promise((resolve, reject) => {
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

async function runAgentRunFrame(options: {
  frame: Record<string, unknown>
  onNewMessage?: (newMessage: Content) => void
  onError?: (err: unknown) => void
}): Promise<void> {
  const db = makeMockDb([[mockUser], [mockCharacter]])

  const originalRunAsync = InMemoryRunner.prototype.runAsync
  // Replace the runner so the handler doesn't reach Vertex AI and we can
  // observe the newMessage it would have sent. The mock yields one final event
  // so consumeAgentEvents settles cleanly and the socket closes.
  ;(
    InMemoryRunner.prototype as unknown as {
      runAsync: (params: { newMessage: Content }) => AsyncGenerator<unknown, void, undefined>
    }
  ).runAsync = function runAsyncMock(params: { newMessage: Content }) {
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

  const { server, close } = createTestWsServer({
    db,
    creditService: { ...mockCreditService, getBalance: async () => 1000 },
    verifyToken: async () => ({ uid: 'firebase-uid' }),
  })
  const port = await listen(server)

  try {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`)
      const timeout = setTimeout(() => reject(new Error('test timeout')), 5000)

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'auth', token: 'valid-token' }))
        ws.send(JSON.stringify(options.frame))
      })

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as { type: string; code?: string }
        if (msg.type === 'error') {
          options.onError?.(msg)
        }
        if (msg.type === 'usage_snapshot') {
          clearTimeout(timeout)
          ws.close()
        }
      })

      ws.on('close', () => {
        clearTimeout(timeout)
        resolve()
      })

      ws.on('error', reject)
    })
  } finally {
    ;(InMemoryRunner.prototype as unknown as { runAsync: typeof originalRunAsync }).runAsync =
      originalRunAsync
    await close()
  }
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
      ws.send(
        JSON.stringify({
          type: 'agent_run',
          message: 'hello',
          characterId: CHAR_UUID,
        }),
      )
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
      ws.send(
        JSON.stringify({
          type: 'agent_run',
          message: 'hello',
          characterId: CHAR_UUID,
        }),
      )
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

function collectFrameTypes(ws: WebSocket, types: string[]): void {
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString()) as { type: string }
    types.push(msg.type)
  })
}

const AGENT_RUN_FRAME = { type: 'agent_run', message: 'hello', characterId: CHAR_UUID }

test('emits agent_image before usage_snapshot when mockGeneratedImage provided', async () => {
  const db = makeMockDb([[mockUser], [mockCharacter]])
  const { server, close } = createTestWsServer({
    db,
    // Above AGENT_TURN_CREDIT_COST so the turn survives the pre-flight check.
    creditService: { ...mockCreditService, getBalance: async () => 1000 },
    verifyToken: async () => ({ uid: 'firebase-uid' }),
    mockStreamReply: 'Hello from WebSocket',
    mockGeneratedImage: { imageBase64: 'QUJD', mimeType: 'image/png' },
  })
  const port = await listen(server)

  const frameTypes: string[] = []
  let imageFrame: { type: string; imageBase64?: string; mimeType?: string } | null = null

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    collectFrameTypes(ws, frameTypes)
    const timeout = setTimeout(() => reject(new Error('test timeout')), 5000)

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'valid-token' }))
      ws.send(JSON.stringify(AGENT_RUN_FRAME))
    })

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as {
        type: string
        imageBase64?: string
        mimeType?: string
      }
      if (msg.type === 'agent_image') imageFrame = msg
      if (msg.type === 'usage_snapshot') {
        clearTimeout(timeout)
        ws.close()
      }
    })

    ws.on('close', () => resolve())
    ws.on('error', reject)
  })

  await close()

  assert.ok(imageFrame, 'expected an agent_image frame')
  assert.equal((imageFrame as { imageBase64?: string }).imageBase64, 'QUJD')
  assert.equal((imageFrame as { mimeType?: string }).mimeType, 'image/png')
  assert.deepEqual(
    frameTypes.filter((t) => t === 'agent_image'),
    ['agent_image'],
    `expected exactly one agent_image frame; got ${JSON.stringify(frameTypes)}`,
  )
  assert.ok(
    frameTypes.indexOf('agent_image') !== -1 &&
      frameTypes.indexOf('agent_image') < frameTypes.indexOf('usage_snapshot'),
    `agent_image must precede usage_snapshot; got ${JSON.stringify(frameTypes)}`,
  )
})

test('omits agent_image when no image was generated', async () => {
  const db = makeMockDb([[mockUser], [mockCharacter]])
  const { server, close } = createTestWsServer({
    db,
    // Above AGENT_TURN_CREDIT_COST so the turn survives the pre-flight check.
    creditService: { ...mockCreditService, getBalance: async () => 1000 },
    verifyToken: async () => ({ uid: 'firebase-uid' }),
    mockStreamReply: 'Hello from WebSocket',
  })
  const port = await listen(server)

  const frameTypes: string[] = []
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    collectFrameTypes(ws, frameTypes)
    const timeout = setTimeout(() => reject(new Error('test timeout')), 5000)

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'valid-token' }))
      ws.send(JSON.stringify(AGENT_RUN_FRAME))
    })

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as { type: string }
      if (msg.type === 'usage_snapshot') {
        clearTimeout(timeout)
        ws.close()
      }
    })

    ws.on('close', () => resolve())
    ws.on('error', reject)
  })

  await close()
  // The turn must have completed — otherwise the absence below is vacuous.
  assert.ok(
    frameTypes.includes('usage_snapshot'),
    `expected the turn to complete; got ${JSON.stringify(frameTypes)}`,
  )
  assert.equal(frameTypes.includes('agent_image'), false)
})

test('rejects invalid token with 4001 close code', async () => {
  const db = makeMockDb()
  const { server, close } = createTestWsServer({
    db,
    verifyToken: async () => {
      throw new Error('Invalid token')
    },
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

test('returns INSUFFICIENT_CREDITS error when balance is zero before agent starts', async () => {
  const db = makeMockDb([[mockUser], [mockCharacter]])
  const cs = {
    ...mockCreditService,
    getBalance: async () => 0,
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
      ws.send(
        JSON.stringify({
          type: 'agent_run',
          message: 'hello',
          characterId: CHAR_UUID,
        }),
      )
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

test('WS agent_run forwards an attachment as a leading inlineData part', async () => {
  const captured: unknown[] = []
  await runAgentRunFrame({
    frame: {
      type: 'agent_run',
      message: 'what is this?',
      characterId: CHAR_UUID,
      attachments: [{ mimeType: 'image/webp', data: 'AAAA' }],
    },
    onNewMessage: (newMessage) => captured.push(newMessage),
  })

  assert.deepEqual(captured[0], {
    role: 'user',
    parts: [{ inlineData: { mimeType: 'image/webp', data: 'AAAA' } }, { text: 'what is this?' }],
  })
})

test('WS accepts a captionless photo', async () => {
  const errors: unknown[] = []
  await runAgentRunFrame({
    frame: {
      type: 'agent_run',
      message: '',
      characterId: CHAR_UUID,
      attachments: [{ mimeType: 'image/webp', data: 'AAAA' }],
    },
    onError: (err) => errors.push(err),
  })
  assert.deepEqual(errors, [])
})
