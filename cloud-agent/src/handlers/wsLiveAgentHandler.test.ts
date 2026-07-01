import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer, type Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import type { DrizzleClient } from '../db/client.js'
import { handleLiveWsUpgrade, makeBillingController, type WsLiveHandlerOptions } from './wsLiveAgentHandler.js'
import { createApp, attachWebSocketRoutes, type AppOptions } from '../index.js'

// ── Mock helpers ─────────────────────────────────────────────────────────────

const CHAR_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const mockUser = { id: 'user-uuid-1' }
const mockCharacter = {
  id: CHAR_UUID,
  userId: 'user-uuid-1',
  name: 'Alice',
  appearance: null,
  traits: null,
  emotions: null,
  context: null,
  voice: null,
}

function makeMockDb(queryRowSets: Record<string, unknown>[][] = []) {
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

const mockCreditService = {
  spendCredit: async (_userId: string): Promise<string> => 'mock-txid',
  refundCredit: async (_userId: string, _txId: string): Promise<void> => {},
  getBalance: async (_userId: string): Promise<number> => 42,
}

type MockGeminiSession = {
  sendRealtimeInput: (i: { audio: { data: string; mimeType: string } }) => void
  sendToolResponse: (r: {
    functionResponses: Array<{ id: string; name: string; response: { output: unknown } }>
  }) => void
  close: () => void
}

function makeMockLiveConnect() {
  const realtimeInputs: Array<{ audio: { data: string; mimeType: string } }> = []
  const toolResponses: Array<{ functionResponses: Array<{ id: string; name: string; response: { output: unknown } }> }> = []
  let _onmessage: ((msg: unknown) => void) | null = null
  let _onclose: (() => void) | null = null
  let session: MockGeminiSession | null = null
  let lastConnectConfig: unknown = null

  const connect = async (cfg: {
    config?: unknown
    callbacks: { onmessage: (m: unknown) => void; onclose: () => void; onerror?: (e: unknown) => void }
  }): Promise<MockGeminiSession> => {
    lastConnectConfig = cfg
    _onmessage = cfg.callbacks.onmessage
    _onclose = cfg.callbacks.onclose
    session = {
      sendRealtimeInput(i) { realtimeInputs.push(i) },
      sendToolResponse(r) { toolResponses.push(r) },
      close() {},
    }
    return session
  }

  return {
    connect,
    realtimeInputs,
    toolResponses,
    triggerMessage: (msg: unknown) => _onmessage?.(msg),
    triggerClose: () => _onclose?.(),
    getSession: () => session,
    getLastConnectConfig: () => lastConnectConfig,
  }
}

function createLiveTestServer(opts: WsLiveHandlerOptions): {
  server: Server
  close: () => Promise<void>
} {
  const server = createServer()
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      void handleLiveWsUpgrade(ws, req, opts)
    })
  })
  return {
    server,
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

// ── Tests ─────────────────────────────────────────────────────────────────────

test('pauseBilling stops the interval from spending; resume restarts', () => {
  let spends = 0
  const fakeSetInterval = (fn: () => void) => { ;(fakeSetInterval as unknown as { fn: () => void }).fn = fn; return 1 as unknown as ReturnType<typeof setInterval> }
  const ctrl = makeBillingController({
    spend: () => { spends++ },
    setIntervalFn: fakeSetInterval as never,
    clearIntervalFn: () => {},
    intervalMs: 1000,
  })
  ctrl.start()
  ;(fakeSetInterval as unknown as { fn: () => void }).fn() // tick → spend
  ctrl.pause()
  ;(fakeSetInterval as unknown as { fn: () => void }).fn() // tick while paused → no spend
  ctrl.resume()
  ;(fakeSetInterval as unknown as { fn: () => void }).fn() // tick → spend
  assert.equal(spends, 2)
})

test('auth timeout closes with 4001', { timeout: 8000 }, async () => {
  const db = makeMockDb()
  const { server, close } = createLiveTestServer({
    db,
    creditService: mockCreditService,
    verifyToken: async () => ({ uid: 'uid' }),
    billingIntervalMs: 60_000,
  })
  const port = await listen(server)

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    ws.on('close', (code) => {
      assert.equal(code, 4001)
      resolve()
    })
    ws.on('error', reject)
    setTimeout(() => reject(new Error('timeout')), 7000)
  })

  await close()
})

test('invalid token closes with 4001', async () => {
  const db = makeMockDb()
  const { server, close } = createLiveTestServer({
    db,
    creditService: mockCreditService,
    verifyToken: async () => { throw new Error('bad token') },
  })
  const port = await listen(server)

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const timeout = setTimeout(() => reject(new Error('test timeout')), 5000)
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'bad', characterId: CHAR_UUID }))
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

test('character not found closes with 4404', async () => {
  const db = makeMockDb([[mockUser], []])
  const mock = makeMockLiveConnect()
  const { server, close } = createLiveTestServer({
    db,
    creditService: mockCreditService,
    verifyToken: async () => ({ uid: 'uid' }),
    liveConnect: mock.connect,
  })
  const port = await listen(server)

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const timeout = setTimeout(() => reject(new Error('test timeout')), 5000)
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'valid', characterId: CHAR_UUID }))
    })
    ws.on('close', (code) => {
      clearTimeout(timeout)
      assert.equal(code, 4404)
      resolve()
    })
    ws.on('error', reject)
  })

  await close()
})

test('zero credits at open closes with 4402', async () => {
  const db = makeMockDb([[mockUser]])
  const cs = { ...mockCreditService, getBalance: async () => 0 }
  const mock = makeMockLiveConnect()
  const { server, close } = createLiveTestServer({
    db,
    creditService: cs,
    verifyToken: async () => ({ uid: 'uid' }),
    liveConnect: mock.connect,
  })
  const port = await listen(server)

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const timeout = setTimeout(() => reject(new Error('test timeout')), 5000)
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'valid', characterId: CHAR_UUID }))
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

test('one credit at open closes with 4402', async () => {
  const db = makeMockDb([[mockUser]])
  const cs = { ...mockCreditService, getBalance: async () => 1 }
  const mock = makeMockLiveConnect()
  const { server, close } = createLiveTestServer({
    db,
    creditService: cs,
    verifyToken: async () => ({ uid: 'uid' }),
    liveConnect: mock.connect,
  })
  const port = await listen(server)

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const timeout = setTimeout(() => reject(new Error('test timeout')), 5000)
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'valid', characterId: CHAR_UUID }))
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

test('valid auth sends session_ready with balance', async () => {
  const db = makeMockDb([[mockUser], [mockCharacter]])
  const cs = { ...mockCreditService, getBalance: async () => 77 }
  const mock = makeMockLiveConnect()
  const { server, close } = createLiveTestServer({
    db,
    creditService: cs,
    verifyToken: async () => ({ uid: 'uid' }),
    liveConnect: mock.connect,
    billingIntervalMs: 60_000,
  })
  const port = await listen(server)

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const timeout = setTimeout(() => reject(new Error('test timeout')), 5000)
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'valid', characterId: CHAR_UUID }))
    })
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as { type: string; remainingCredits?: number }
      if (msg.type === 'session_ready') {
        clearTimeout(timeout)
        assert.equal(msg.remainingCredits, 77)
        ws.close()
        resolve()
      }
    })
    ws.on('error', reject)
  })

  await close()
})

test('memoryQuery preloads wiki context into the live system instruction', async () => {
  const db = makeMockDb([
    [mockUser],
    [mockCharacter],
    [{ title: 'Weather in Austin', body: 'Sunny and 72F today' }],
  ])
  const mock = makeMockLiveConnect()
  const { server, close } = createLiveTestServer({
    db,
    creditService: mockCreditService,
    verifyToken: async () => ({ uid: 'uid' }),
    liveConnect: mock.connect,
    billingIntervalMs: 60_000,
  })
  const port = await listen(server)

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const timeout = setTimeout(() => reject(new Error('test timeout')), 5000)
    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'auth',
        token: 'valid',
        characterId: CHAR_UUID,
        memoryQuery: 'User: What is the weather in Austin?',
      }))
    })
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as { type: string }
      if (msg.type === 'session_ready') {
        clearTimeout(timeout)
        const cfg = mock.getLastConnectConfig() as { config?: { systemInstruction?: string } }
        assert.match(cfg.config?.systemInstruction ?? '', /Known facts about the user/)
        assert.match(cfg.config?.systemInstruction ?? '', /Weather in Austin/)
        ws.close()
        resolve()
      }
    })
    ws.on('error', reject)
  })

  await close()
})

test('recentChatContext injects verbatim chat turns into the live system instruction', async () => {
  const db = makeMockDb([[mockUser], [mockCharacter]])
  const mock = makeMockLiveConnect()
  const { server, close } = createLiveTestServer({
    db,
    creditService: mockCreditService,
    verifyToken: async () => ({ uid: 'uid' }),
    liveConnect: mock.connect,
    billingIntervalMs: 60_000,
  })
  const port = await listen(server)

  const recentChatContext =
    'User: What is the weather in Austin?\nAlice: It is sunny and 72F today.'

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const timeout = setTimeout(() => reject(new Error('test timeout')), 5000)
    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'auth',
        token: 'valid',
        characterId: CHAR_UUID,
        recentChatContext,
      }))
    })
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as { type: string }
      if (msg.type === 'session_ready') {
        clearTimeout(timeout)
        const cfg = mock.getLastConnectConfig() as { config?: { systemInstruction?: string } }
        assert.match(cfg.config?.systemInstruction ?? '', /Recent chat history/)
        assert.match(cfg.config?.systemInstruction ?? '', /sunny and 72F today/)
        ws.close()
        resolve()
      }
    })
    ws.on('error', reject)
  })

  await close()
})

test('audio_input calls sendRealtimeInput with correct MIME type', async () => {
  const db = makeMockDb([[mockUser], [mockCharacter]])
  const mock = makeMockLiveConnect()
  const { server, close } = createLiveTestServer({
    db,
    creditService: mockCreditService,
    verifyToken: async () => ({ uid: 'uid' }),
    liveConnect: mock.connect,
    billingIntervalMs: 60_000,
  })
  const port = await listen(server)

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const timeout = setTimeout(() => reject(new Error('test timeout')), 5000)
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'valid', characterId: CHAR_UUID }))
    })
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as { type: string }
      if (msg.type === 'session_ready') {
        ws.send(JSON.stringify({ type: 'audio_input', data: 'AAAA' }))
        setTimeout(() => {
          clearTimeout(timeout)
          assert.equal(mock.realtimeInputs.length, 1)
          assert.equal(mock.realtimeInputs[0]!.audio.data, 'AAAA')
          assert.equal(mock.realtimeInputs[0]!.audio.mimeType, 'audio/pcm;rate=16000')
          ws.close()
          resolve()
        }, 50)
      }
    })
    ws.on('error', reject)
  })

  await close()
})

test('toolCall triggers tool_start, executor, sendToolResponse, tool_end in order', async () => {
  const db = makeMockDb([[mockUser], [mockCharacter]])
  const mock = makeMockLiveConnect()
  const { server, close } = createLiveTestServer({
    db,
    creditService: mockCreditService,
    verifyToken: async () => ({ uid: 'uid' }),
    liveConnect: mock.connect,
    billingIntervalMs: 60_000,
  })
  const port = await listen(server)

  const events: string[] = []

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const timeout = setTimeout(() => reject(new Error('test timeout')), 5000)
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'valid', characterId: CHAR_UUID }))
    })
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as { type: string; name?: string }
      if (msg.type === 'session_ready') {
        mock.triggerMessage({
          toolCall: {
            functionCalls: [{ id: 'call-1', name: 'get_current_time', args: {} }],
          },
        })
      }
      if (msg.type === 'tool_start') events.push(`start:${msg.name}`)
      if (msg.type === 'tool_end') {
        events.push(`end:${msg.name}`)
        clearTimeout(timeout)
        assert.equal(mock.toolResponses.length, 1)
        assert.equal(mock.toolResponses[0]!.functionResponses[0]!.id, 'call-1')
        assert.equal(mock.toolResponses[0]!.functionResponses[0]!.name, 'get_current_time')
        assert.deepEqual(events, ['start:get_current_time', 'end:get_current_time'])
        ws.close()
        resolve()
      }
    })
    ws.on('error', reject)
  })

  await close()
})

test('inline functionCall in modelTurn parts triggers tool execution when id is present', async () => {
  const db = makeMockDb([[mockUser], [mockCharacter]])
  const mock = makeMockLiveConnect()
  const { server, close } = createLiveTestServer({
    db,
    creditService: mockCreditService,
    verifyToken: async () => ({ uid: 'uid' }),
    liveConnect: mock.connect,
    billingIntervalMs: 60_000,
  })
  const port = await listen(server)

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const timeout = setTimeout(() => reject(new Error('test timeout')), 5000)
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'valid', characterId: CHAR_UUID }))
    })
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as { type: string; name?: string }
      if (msg.type === 'session_ready') {
        mock.triggerMessage({
          serverContent: {
            modelTurn: {
              parts: [{ functionCall: { id: 'inline-call-1', name: 'get_current_time', args: {} } }],
            },
          },
        })
      }
      if (msg.type === 'tool_end' && msg.name === 'get_current_time') {
        clearTimeout(timeout)
        assert.equal(mock.toolResponses.length, 1)
        assert.equal(mock.toolResponses[0]!.functionResponses[0]!.id, 'inline-call-1')
        ws.close()
        resolve()
      }
    })
    ws.on('error', reject)
  })

  await close()
})

test('inline functionCall without id is skipped', async () => {
  const db = makeMockDb([[mockUser], [mockCharacter]])
  const mock = makeMockLiveConnect()
  const { server, close } = createLiveTestServer({
    db,
    creditService: mockCreditService,
    verifyToken: async () => ({ uid: 'uid' }),
    liveConnect: mock.connect,
    billingIntervalMs: 60_000,
  })
  const port = await listen(server)

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const timeout = setTimeout(() => reject(new Error('test timeout')), 5000)
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'valid', characterId: CHAR_UUID }))
    })
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as { type: string }
      if (msg.type === 'session_ready') {
        mock.triggerMessage({
          serverContent: {
            modelTurn: {
              parts: [{ functionCall: { name: 'get_current_time', args: {} } }],
            },
          },
        })
        setTimeout(() => {
          clearTimeout(timeout)
          assert.equal(mock.toolResponses.length, 0)
          ws.close()
          resolve()
        }, 100)
      }
    })
    ws.on('error', reject)
  })

  await close()
})

test('groundingMetadata in serverContent forwards grounding_metadata to client', async () => {
  const db = makeMockDb([[mockUser], [mockCharacter]])
  const mock = makeMockLiveConnect()
  const { server, close } = createLiveTestServer({
    db,
    creditService: mockCreditService,
    verifyToken: async () => ({ uid: 'uid' }),
    liveConnect: mock.connect,
    billingIntervalMs: 60_000,
  })
  const port = await listen(server)

  const groundingMetadata = {
    webSearchQueries: ['weather today'],
    groundingChunks: [{ web: { uri: 'https://example.com', title: 'Example' } }],
    searchEntryPoint: { renderedContent: '<div>Suggestions</div>' },
  }

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const timeout = setTimeout(() => reject(new Error('test timeout')), 5000)
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'valid', characterId: CHAR_UUID }))
    })
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as { type: string; groundingMetadata?: unknown }
      if (msg.type === 'session_ready') {
        mock.triggerMessage({ serverContent: { groundingMetadata } })
      }
      if (msg.type === 'grounding_metadata') {
        clearTimeout(timeout)
        assert.deepEqual(msg.groundingMetadata, groundingMetadata)
        ws.close()
        resolve()
      }
    })
    ws.on('error', reject)
  })

  await close()
})

test('searchEntryPoint-only groundingMetadata forwards grounding_metadata to client', async () => {
  const db = makeMockDb([[mockUser], [mockCharacter]])
  const mock = makeMockLiveConnect()
  const { server, close } = createLiveTestServer({
    db,
    creditService: mockCreditService,
    verifyToken: async () => ({ uid: 'uid' }),
    liveConnect: mock.connect,
    billingIntervalMs: 60_000,
  })
  const port = await listen(server)

  const googleHtml = '<style>.gs-chip{color:#1a73e8}</style><div class="gs-chip">Try this</div>'
  const groundingMetadata = {
    searchEntryPoint: { renderedContent: googleHtml },
  }

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const timeout = setTimeout(() => reject(new Error('test timeout')), 5000)
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'valid', characterId: CHAR_UUID }))
    })
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as { type: string; groundingMetadata?: unknown }
      if (msg.type === 'session_ready') {
        mock.triggerMessage({ serverContent: { groundingMetadata } })
      }
      if (msg.type === 'grounding_metadata') {
        clearTimeout(timeout)
        assert.deepEqual(msg.groundingMetadata, groundingMetadata)
        ws.close()
        resolve()
      }
    })
    ws.on('error', reject)
  })

  await close()
})

test('empty serverContent groundingMetadata does not emit grounding_metadata', async () => {
  const db = makeMockDb([[mockUser], [mockCharacter]])
  const mock = makeMockLiveConnect()
  const { server, close } = createLiveTestServer({
    db,
    creditService: mockCreditService,
    verifyToken: async () => ({ uid: 'uid' }),
    liveConnect: mock.connect,
    billingIntervalMs: 60_000,
  })
  const port = await listen(server)

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const timeout = setTimeout(() => reject(new Error('test timeout')), 5000)
    const received: string[] = []
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'valid', characterId: CHAR_UUID }))
    })
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as { type: string }
      received.push(msg.type)
      if (msg.type === 'session_ready') {
        mock.triggerMessage({ serverContent: { groundingMetadata: {} } })
        mock.triggerMessage({ serverContent: {} })
        setTimeout(() => {
          clearTimeout(timeout)
          assert.equal(received.includes('grounding_metadata'), false)
          ws.close()
          resolve()
        }, 50)
      }
    })
    ws.on('error', reject)
  })

  await close()
})

test('liveConnect config includes googleSearch alongside functionDeclarations', async () => {
  const db = makeMockDb([[mockUser], [mockCharacter]])
  const mock = makeMockLiveConnect()
  const { server, close } = createLiveTestServer({
    db,
    creditService: mockCreditService,
    verifyToken: async () => ({ uid: 'uid' }),
    liveConnect: mock.connect,
    billingIntervalMs: 60_000,
  })
  const port = await listen(server)

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const timeout = setTimeout(() => reject(new Error('test timeout')), 5000)
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'valid', characterId: CHAR_UUID }))
    })
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as { type: string }
      if (msg.type === 'session_ready') {
        clearTimeout(timeout)
        const cfg = mock.getLastConnectConfig() as { config?: { tools?: unknown[] } } | null
        const tools = cfg?.config?.tools as Array<Record<string, unknown>> | undefined
        assert.ok(Array.isArray(tools), 'expected tools array in liveConnect config')
        assert.ok(
          tools!.some((t) => Array.isArray(t.functionDeclarations) && t.functionDeclarations.length > 0),
          'expected functionDeclarations tool entry',
        )
        assert.ok(
          tools!.some((t) => t.googleSearch !== undefined),
          'expected googleSearch tool entry',
        )
        ws.close()
        resolve()
      }
    })
    ws.on('error', reject)
  })

  await close()
})

test('billing tick with INSUFFICIENT_CREDITS sends usage_snapshot(0) + error + closes', async () => {
  const db = makeMockDb([[mockUser], [mockCharacter]])
  const cs = {
    ...mockCreditService,
    spendCredit: async (): Promise<string> => {
      throw new Error('INSUFFICIENT_CREDITS')
    },
  }
  const mock = makeMockLiveConnect()
  const { server, close } = createLiveTestServer({
    db,
    creditService: cs,
    verifyToken: async () => ({ uid: 'uid' }),
    liveConnect: mock.connect,
    billingIntervalMs: 80,
  })
  const port = await listen(server)

  const received: Record<string, unknown>[] = []

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const timeout = setTimeout(() => reject(new Error('test timeout')), 3000)
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'valid', characterId: CHAR_UUID }))
    })
    ws.on('message', (data) => {
      received.push(JSON.parse(data.toString()) as Record<string, unknown>)
    })
    ws.on('close', () => {
      clearTimeout(timeout)
      const snapshot = received.find((m) => m['type'] === 'usage_snapshot')
      const error = received.find((m) => m['type'] === 'error')
      assert.ok(snapshot, 'expected usage_snapshot')
      assert.equal(snapshot!['remainingCredits'], 0)
      assert.ok(error, 'expected error message')
      assert.equal((error as { code: string })['code'], 'INSUFFICIENT_CREDITS')
      resolve()
    })
    ws.on('error', reject)
  })

  await close()
})

test('billing ticks do not overlap when spendCredit is slow', async () => {
  let spendCalls = 0
  const cs = {
    ...mockCreditService,
    spendCredit: async (): Promise<string> => {
      spendCalls++
      await new Promise((resolve) => setTimeout(resolve, 120))
      return 'mock-txid'
    },
  }
  const db = makeMockDb([[mockUser], [mockCharacter]])
  const mock = makeMockLiveConnect()
  const { server, close } = createLiveTestServer({
    db,
    creditService: cs,
    verifyToken: async () => ({ uid: 'uid' }),
    liveConnect: mock.connect,
    billingIntervalMs: 40,
  })
  const port = await listen(server)

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const timeout = setTimeout(() => reject(new Error('test timeout')), 5000)
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'valid', characterId: CHAR_UUID }))
    })
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as { type: string }
      if (msg.type === 'session_ready') {
        setTimeout(() => {
          clearTimeout(timeout)
          assert.ok(spendCalls <= 3, `expected at most 3 spend calls, got ${spendCalls}`)
          ws.close()
          resolve()
        }, 250)
      }
    })
    ws.on('error', reject)
  })

  await close()
})

test('sendToolResponse failure still completes tool_end without unhandled rejection', async () => {
  const db = makeMockDb([[mockUser], [mockCharacter]])
  const mock = makeMockLiveConnect()
  const throwingConnect = async (cfg: Parameters<typeof mock.connect>[0]): Promise<MockGeminiSession> => {
    const session = await mock.connect(cfg)
    return {
      ...session,
      sendToolResponse() {
        throw new Error('session closed')
      },
    }
  }
  const { server, close } = createLiveTestServer({
    db,
    creditService: mockCreditService,
    verifyToken: async () => ({ uid: 'uid' }),
    liveConnect: throwingConnect,
    billingIntervalMs: 60_000,
  })
  const port = await listen(server)

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const timeout = setTimeout(() => reject(new Error('test timeout')), 5000)
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'valid', characterId: CHAR_UUID }))
    })
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as { type: string; name?: string }
      if (msg.type === 'session_ready') {
        mock.triggerMessage({
          toolCall: {
            functionCalls: [{ id: 'call-1', name: 'get_current_time', args: {} }],
          },
        })
      }
      if (msg.type === 'tool_end' && msg.name === 'get_current_time') {
        clearTimeout(timeout)
        ws.close()
        resolve()
      }
    })
    ws.on('error', reject)
  })

  await close()
})

test('end_session sends session_ended and closes', async () => {
  const db = makeMockDb([[mockUser], [mockCharacter]])
  const mock = makeMockLiveConnect()
  const { server, close } = createLiveTestServer({
    db,
    creditService: mockCreditService,
    verifyToken: async () => ({ uid: 'uid' }),
    liveConnect: mock.connect,
    billingIntervalMs: 60_000,
  })
  const port = await listen(server)

  const received: Record<string, unknown>[] = []

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const timeout = setTimeout(() => reject(new Error('test timeout')), 5000)
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'valid', characterId: CHAR_UUID }))
    })
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as { type: string }
      received.push(msg)
      if (msg.type === 'session_ready') {
        ws.send(JSON.stringify({ type: 'end_session' }))
      }
    })
    ws.on('close', () => {
      clearTimeout(timeout)
      assert.ok(received.some((m) => m['type'] === 'session_ended'), 'expected session_ended')
      resolve()
    })
    ws.on('error', reject)
  })

  await close()
})

test('client WS close clears billing timer (clearInterval spy)', async () => {
  const db = makeMockDb([[mockUser], [mockCharacter]])
  const mock = makeMockLiveConnect()
  let clearIntervalCalled = false
  const origClearInterval = globalThis.clearInterval.bind(globalThis)
  const patchedClearInterval = (id: ReturnType<typeof setInterval> | undefined) => {
    if (id !== undefined) clearIntervalCalled = true
    origClearInterval(id)
  }

  const { server, close } = createLiveTestServer({
    db,
    creditService: mockCreditService,
    verifyToken: async () => ({ uid: 'uid' }),
    liveConnect: mock.connect,
    billingIntervalMs: 60_000,
    _clearInterval: patchedClearInterval,
  })
  const port = await listen(server)

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const timeout = setTimeout(() => reject(new Error('test timeout')), 5000)
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'valid', characterId: CHAR_UUID }))
    })
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as { type: string }
      if (msg.type === 'session_ready') {
        ws.close()
      }
    })
    ws.on('close', () => {
      clearTimeout(timeout)
      setTimeout(() => {
        assert.ok(clearIntervalCalled, 'expected clearInterval to be called on client close')
        resolve()
      }, 20)
    })
    ws.on('error', reject)
  })

  await close()
})

test('Gemini close callback sends GEMINI_DISCONNECTED error and closes socket', async () => {
  const db = makeMockDb([[mockUser], [mockCharacter]])
  const mock = makeMockLiveConnect()
  const { server, close } = createLiveTestServer({
    db,
    creditService: mockCreditService,
    verifyToken: async () => ({ uid: 'uid' }),
    liveConnect: mock.connect,
    billingIntervalMs: 60_000,
  })
  const port = await listen(server)

  const received: Record<string, unknown>[] = []

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const timeout = setTimeout(() => reject(new Error('test timeout')), 5000)
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'valid', characterId: CHAR_UUID }))
    })
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>
      received.push(msg)
      if (msg['type'] === 'session_ready') {
        mock.triggerClose()
      }
    })
    ws.on('close', () => {
      clearTimeout(timeout)
      const error = received.find((m) => m['type'] === 'error')
      assert.ok(error, 'expected error message')
      assert.equal((error as { code: string })['code'], 'GEMINI_DISCONNECTED')
      resolve()
    })
    ws.on('error', reject)
  })

  await close()
})

test('attachWebSocketRoutes: /agent/stream and /agent/live both accept connections', async () => {
  const db = makeMockDb([[mockUser], [mockCharacter], [mockUser], [mockCharacter]])
  const mock = makeMockLiveConnect()

  const appOptions: AppOptions = {
    verifyToken: async () => ({ uid: 'uid' }),
    db,
    runAgentFn: async () => ({ reply: 'ok', toolCalls: [] }),
    creditService: mockCreditService,
    wsHandlerOptions: { mockStreamReply: 'hello' },
    wsLiveHandlerOptions: {
      liveConnect: mock.connect,
      billingIntervalMs: 60_000,
    },
  }

  const app = createApp(appOptions)
  const httpServer = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => httpServer.on('listening', resolve))
  attachWebSocketRoutes(httpServer, appOptions)

  const addr = httpServer.address() as { port: number }
  const port = addr.port

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/agent/stream`)
    const timeout = setTimeout(() => reject(new Error('stream timeout')), 5000)
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'valid' }))
      ws.send(JSON.stringify({ type: 'agent_run', message: 'hi', characterId: CHAR_UUID }))
    })
    ws.on('close', () => { clearTimeout(timeout); resolve() })
    ws.on('error', reject)
  })

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/agent/live`)
    const timeout = setTimeout(() => reject(new Error('live timeout')), 5000)
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'valid', characterId: CHAR_UUID }))
    })
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as { type: string }
      if (msg.type === 'session_ready') {
        clearTimeout(timeout)
        ws.close()
        resolve()
      }
    })
    ws.on('error', reject)
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.close((err) => (err ? reject(err) : resolve()))
  })
})

test('pushToLive falls back to Expo Push when voice WS is closed', { timeout: 5000 }, async () => {
  const db = makeMockDb([[mockUser], [mockCharacter]])

  const expoPushCalls: Array<{ token: string; sessionId: string; taskId: string; text: string }> = []
  const mockFcmDispatcher = {
    wakeExtension: async () => {},
    sendApprovalCard: async () => {},
    sendTaskComplete: async (token: string, sessionId: string, taskId: string, text: string) => {
      expoPushCalls.push({ token, sessionId, taskId, text })
    },
    sendProactive: async () => {},
  }

  let watchTaskCallback: ((task: unknown) => void) | null = null
  const mockFirestoreSession = {
    getActiveDevice: async () => ({ deviceId: 'd1', fcmToken: 'fcm-tok', deviceName: 'Mac' }),
    createSession: async () => {},
    writeTask: async () => {},
    closeSession: async () => {},
    writeTaskResult: async () => {},
    getTask: async () => ({ status: 'pending' }),
    getSession: async () => ({ browserInstanceId: null, browserConnectedAt: null }),
    abortPendingTaskIfOffline: async () => false,
    watchTask: (_uid: string, _sid: string, _tid: string, cb: (task: unknown) => void) => {
      watchTaskCallback = cb
      return () => {}
    },
  }

  const mock = makeMockLiveConnect()
  const { server, close } = createLiveTestServer({
    db,
    creditService: mockCreditService,
    verifyToken: async () => ({ uid: 'fb-uid-1' }),
    liveConnect: mock.connect,
    getExpoPushToken: async () => 'ExponentPushToken[test]',
    browserBridge: {
      firebaseUid: 'fb-uid-1',
      userId: 'user-uuid-1',
      firestoreSession: mockFirestoreSession as never,
      fcmDispatcher: mockFcmDispatcher as never,
      creditService: mockCreditService,
      instanceId: 'inst-1',
      wakeTimeoutMs: 50,
      textTimeoutMs: 500,
    },
  })
  try {
    const port = await listen(server)

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`)
      const timeout = setTimeout(() => reject(new Error('test timeout')), 4500)

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'auth', token: 'valid', characterId: CHAR_UUID }))
      })

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as { type: string }
        if (msg.type !== 'session_ready') return

        // Simulate Gemini invoking browser_action
        mock.triggerMessage({
          toolCall: {
            functionCalls: [{ id: 'call-1', name: 'browser_action', args: {
              actionSummary: 'Extract price',
              intent: { action: { type: 'extract', selector: '.price', label: 'price' } },
            }}],
          },
        })

        // Close the WS before the task result arrives
        setTimeout(() => ws.close(), 20)
      })

      ws.on('close', async () => {
        // Task result arrives after WS is closed
        await new Promise((r) => setTimeout(r, 100))
        watchTaskCallback?.({ status: 'complete', result: { data: { price: '$340' }, activeUrl: 'https://example.com' }, error: null })

        await new Promise((r) => setTimeout(r, 100))

        clearTimeout(timeout)
        try {
          assert.equal(expoPushCalls.length, 1, 'sendTaskComplete should be called once')
          assert.equal(expoPushCalls[0].token, 'ExponentPushToken[test]')
          assert.match(expoPushCalls[0].text, /\$340|complete/i)
          resolve()
        } catch (e) {
          reject(e)
        }
      })

      ws.on('error', reject)
    })
  } finally {
    await close()
  }
})

test('pushToLive uses DB lookup for expoPushToken when getExpoPushToken not injected', { timeout: 5000 }, async () => {
  const expoPushRow = [{ expoPushToken: 'ExponentPushToken[db]' }]
  const db = makeMockDb([[mockUser], [mockCharacter], expoPushRow])

  const proactiveCalls: Array<{ token: string }> = []
  const mockFcmDispatcher = {
    wakeExtension: async () => {},
    sendTaskComplete: async (token: string) => { proactiveCalls.push({ token }) },
    sendProactive: async () => {},
  }

  let watchTaskCallback: ((task: unknown) => void) | null = null
  const mockFirestoreSession = {
    getActiveDevice: async () => ({ deviceId: 'd1', fcmToken: 'tok', deviceName: 'Mac' }),
    createSession: async () => {},
    writeTask: async () => {},
    closeSession: async () => {},
    writeTaskResult: async () => {},
    getTask: async () => ({ status: 'pending' }),
    getSession: async () => ({ browserInstanceId: null, browserConnectedAt: null }),
    abortPendingTaskIfOffline: async () => false,
    watchTask: (_u: string, _s: string, _t: string, cb: (task: unknown) => void) => {
      watchTaskCallback = cb
      return () => {}
    },
  }

  const mock = makeMockLiveConnect()
  const { server, close } = createLiveTestServer({
    db,
    creditService: mockCreditService,
    verifyToken: async () => ({ uid: 'fb-uid-2' }),
    liveConnect: mock.connect,
    browserBridge: {
      firebaseUid: 'fb-uid-2',
      userId: 'user-uuid-1',
      firestoreSession: mockFirestoreSession as never,
      fcmDispatcher: mockFcmDispatcher as never,
      creditService: mockCreditService,
      instanceId: 'inst-2',
      wakeTimeoutMs: 50,
      textTimeoutMs: 500,
    },
  })
  try {
    const port = await listen(server)

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`)
      const timeout = setTimeout(() => reject(new Error('test timeout')), 4500)
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: 'v', characterId: CHAR_UUID })))
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as { type: string }
        if (msg.type !== 'session_ready') return
        mock.triggerMessage({
          toolCall: { functionCalls: [{ id: 'c2', name: 'browser_action', args: {
            actionSummary: 'Extract', intent: { action: { type: 'extract', selector: '.p', label: 'p' } },
          }}] },
        })
        setTimeout(() => ws.close(), 20)
      })
      ws.on('close', async () => {
        await new Promise((r) => setTimeout(r, 100))
        watchTaskCallback?.({ status: 'complete', result: { data: { p: 'x' }, activeUrl: 'https://a.com' }, error: null, intent: { action: { type: 'extract', selector: '.p' } } })
        await new Promise((r) => setTimeout(r, 100))
        clearTimeout(timeout)
        try {
          assert.equal(proactiveCalls.length, 1)
          assert.equal(proactiveCalls[0].token, 'ExponentPushToken[db]')
          resolve()
        } catch (e) { reject(e) }
      })
      ws.on('error', reject)
    })
  } finally {
    await close()
  }
})
