# Live Voice Backend (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Cloud Run `/agent/live` WebSocket proxy — auth, Gemini Live bridge, tool intercept, and 60-second credit billing loop.

**Architecture:** A new `handleLiveWsUpgrade` handler authenticates via Firebase, opens a Gemini Live bidi session, routes 16kHz PCM audio in/out, intercepts tool calls and executes them server-side, and bills one credit per 60 seconds. A centralized `attachWebSocketRoutes` function replaces the existing `attachAgentStreamWebSocket` to route both `/agent/stream` and `/agent/live` from one upgrade listener.

**Tech Stack:** `ws`, `@google/genai` (Vertex AI, `ai.live.connect`), `@google/adk` (`FunctionTool`, `_getDeclaration()`), `drizzle-orm`, `firebase-admin`, `zod`

---

## File Map

| Status | Path | Responsibility |
|--------|------|---------------|
| Create | `cloud-agent/src/services/liveToolAdapter.ts` | `buildLiveTools()` + `resolveVoice()` |
| Create | `cloud-agent/src/services/liveToolAdapter.test.ts` | Unit tests for adapter |
| Create | `cloud-agent/src/handlers/wsLiveAgentHandler.ts` | Main handler |
| Create | `cloud-agent/src/handlers/wsLiveAgentHandler.test.ts` | Integration tests |
| Modify | `cloud-agent/src/db/schema.ts` | Add `voice` column to `characters` |
| Modify | `cloud-agent/src/index.ts` | Replace `attachAgentStreamWebSocket` with `attachWebSocketRoutes` |
| Modify | `src/constants/geminiVoices.ts` | Replace 30-voice list with 5-voice `GEMINI_LIVE_VOICES` |
| Modify | `app/(drawer)/(tabs)/characters/[id]/edit.tsx` | Update voice picker to use `GEMINI_LIVE_VOICES` |

---

## Task 1: Add `voice` to cloud-agent characters schema

The cloud-agent schema (`cloud-agent/src/db/schema.ts`) is a bounded-context mirror of the canonical schema. `character.voice` is needed by the live handler but is missing from the mirror. Add it now before any handler code references it.

**Files:**
- Modify: `cloud-agent/src/db/schema.ts:19-31`

- [ ] **Step 1: Add `voice` column to the characters table definition**

Open `cloud-agent/src/db/schema.ts`. The `characters` pgTable currently ends with:
```typescript
export const characters = pgTable('characters', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  appearance: text('appearance'),
  traits: text('traits'),
  emotions: text('emotions'),
  context: text('context'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  userIdIdx: index('characters_user_id_idx').on(table.userId),
}))
```

Add `voice` after `context`:
```typescript
export const characters = pgTable('characters', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  appearance: text('appearance'),
  traits: text('traits'),
  emotions: text('emotions'),
  context: text('context'),
  voice: text('voice'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  userIdIdx: index('characters_user_id_idx').on(table.userId),
}))
```

(`voice` is nullable here — cloud-agent always calls `resolveVoice()` before use.)

- [ ] **Step 2: Verify typecheck passes**

```bash
cd cloud-agent && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add cloud-agent/src/db/schema.ts
git commit -m "feat(live-voice): add voice column to cloud-agent characters schema mirror"
```

---

## Task 2: `liveToolAdapter.ts` — tool adapter and voice resolver (TDD)

**Files:**
- Create: `cloud-agent/src/services/liveToolAdapter.ts`
- Create: `cloud-agent/src/services/liveToolAdapter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `cloud-agent/src/services/liveToolAdapter.test.ts`:

```typescript
import assert from 'node:assert/strict'
import test from 'node:test'
import type { DrizzleClient } from '../db/client.js'
import { resolveVoice, buildLiveTools } from './liveToolAdapter.js'

const mockDb = {} as unknown as DrizzleClient
const mockEmbed = async (_text: string): Promise<number[]> => []

test('resolveVoice returns Aoede for unknown voice', () => {
  assert.equal(resolveVoice('Umbriel'), 'Aoede')
})

test('resolveVoice returns Aoede for null', () => {
  assert.equal(resolveVoice(null), 'Aoede')
})

test('resolveVoice returns Aoede for undefined', () => {
  assert.equal(resolveVoice(undefined), 'Aoede')
})

test('resolveVoice passes through valid Live API voice', () => {
  assert.equal(resolveVoice('Puck'), 'Puck')
  assert.equal(resolveVoice('Aoede'), 'Aoede')
  assert.equal(resolveVoice('Charon'), 'Charon')
  assert.equal(resolveVoice('Fenrir'), 'Fenrir')
  assert.equal(resolveVoice('Kore'), 'Kore')
})

test('buildLiveTools returns 12 declarations', () => {
  const { declarations } = buildLiveTools(mockDb, 'user-1', 'char-1', mockEmbed, 'UTC')
  assert.equal(declarations.length, 12)
})

test('buildLiveTools declarations each have name, description, parameters', () => {
  const { declarations } = buildLiveTools(mockDb, 'user-1', 'char-1', mockEmbed, 'UTC')
  for (const decl of declarations) {
    assert.ok(typeof decl.name === 'string' && decl.name.length > 0, `${decl.name}: missing name`)
    assert.ok(typeof decl.description === 'string' && decl.description.length > 0, `${decl.name}: missing description`)
    assert.ok(decl.parameters !== undefined, `${decl.name}: missing parameters`)
  }
})

test('buildLiveTools executors map has entry for every declared tool', () => {
  const { declarations, executors } = buildLiveTools(mockDb, 'user-1', 'char-1', mockEmbed, 'UTC')
  for (const decl of declarations) {
    assert.ok(executors.has(decl.name), `missing executor for ${decl.name}`)
    assert.equal(typeof executors.get(decl.name), 'function')
  }
})
```

- [ ] **Step 2: Run tests — verify they fail (file doesn't exist yet)**

```bash
cd cloud-agent && npm test 2>&1 | grep -E "FAIL|ERR|liveToolAdapter" | head -20
```

Expected: compilation errors because `liveToolAdapter.js` doesn't exist

- [ ] **Step 3: Implement `liveToolAdapter.ts`**

Create `cloud-agent/src/services/liveToolAdapter.ts`:

```typescript
import type { FunctionDeclaration } from '@google/genai'
import { FunctionTool } from '@google/adk'
import { getCurrentTimeTool } from '../tools/time.js'
import { wikiReadTool, wikiWriteTool } from '../tools/wiki.js'
import { wikiGetOntologyManifestTool, wikiTraverseGraphTool } from '../tools/ontology.js'
import {
  createTaskTool, listTasksTool, updateTaskTool,
  completeTaskTool, deleteTaskTool,
} from '../tools/tasks.js'
import { documentSearchTool } from '../tools/documents.js'
import { setReminderTool } from '../tools/reminders.js'
import type { DrizzleClient } from '../db/client.js'

type EmbedFn = (text: string) => Promise<number[]>

export interface LiveToolSet {
  declarations: FunctionDeclaration[]
  executors: Map<string, (args: unknown) => Promise<unknown>>
}

const LIVE_VOICES = new Set(['Aoede', 'Charon', 'Fenrir', 'Kore', 'Puck'])
const LIVE_VOICE_FALLBACK = 'Aoede'

export function resolveVoice(raw: string | null | undefined): string {
  if (raw && LIVE_VOICES.has(raw)) return raw
  return LIVE_VOICE_FALLBACK
}

export function buildLiveTools(
  db: DrizzleClient,
  userId: string,
  characterId: string,
  embed: EmbedFn,
  timezone: string,
): LiveToolSet {
  const adkTools: FunctionTool[] = [
    getCurrentTimeTool(timezone),
    wikiReadTool(db, userId, characterId, embed),
    wikiWriteTool(db, userId, characterId, embed),
    wikiGetOntologyManifestTool(db, userId, characterId),
    wikiTraverseGraphTool(db, userId, characterId),
    createTaskTool(db, userId, characterId),
    listTasksTool(db, userId, characterId),
    updateTaskTool(db, userId, characterId),
    completeTaskTool(db, userId, characterId),
    deleteTaskTool(db, userId, characterId),
    documentSearchTool(db, userId, characterId),
    setReminderTool(db, userId, characterId),
  ]

  const declarations = adkTools.map((t) => t._getDeclaration() as FunctionDeclaration)

  const executors = new Map(
    adkTools.map((t) => [
      t.name,
      (t as unknown as { execute: (args: unknown) => Promise<unknown> }).execute.bind(t),
    ]),
  )

  return { declarations, executors }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd cloud-agent && npm test 2>&1 | grep -E "PASS|FAIL|liveToolAdapter"
```

Expected: all 6 liveToolAdapter tests pass

- [ ] **Step 5: Commit**

```bash
git add cloud-agent/src/services/liveToolAdapter.ts cloud-agent/src/services/liveToolAdapter.test.ts
git commit -m "feat(live-voice): add liveToolAdapter with buildLiveTools and resolveVoice"
```

---

## Task 3: `wsLiveAgentHandler.ts` integration tests (write first)

**Files:**
- Create: `cloud-agent/src/handlers/wsLiveAgentHandler.test.ts`

This task writes all integration tests before the handler exists. Build will fail until Task 4 creates the handler.

- [ ] **Step 1: Create the test file**

Create `cloud-agent/src/handlers/wsLiveAgentHandler.test.ts`:

```typescript
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer, type Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import type { DrizzleClient } from '../db/client.js'
import { handleLiveWsUpgrade, type WsLiveHandlerOptions } from './wsLiveAgentHandler.js'
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
  sendRealtimeInput: (i: { media: { data: string; mimeType: string } }) => void
  sendToolResponse: (r: {
    functionResponses: Array<{ id: string; name: string; response: { output: unknown } }>
  }) => void
  close: () => void
}

function makeMockLiveConnect() {
  const realtimeInputs: Array<{ media: { data: string; mimeType: string } }> = []
  const toolResponses: Array<{ functionResponses: Array<{ id: string; name: string; response: { output: unknown } }> }> = []
  let _onmessage: ((msg: unknown) => void) | null = null
  let _onclose: (() => void) | null = null
  let session: MockGeminiSession | null = null

  const connect = async (cfg: {
    callbacks: { onmessage: (m: unknown) => void; onclose: () => void }
  }): Promise<MockGeminiSession> => {
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

function collectMessages(ws: WebSocket): { msgs: Record<string, unknown>[] } {
  const msgs: Record<string, unknown>[] = []
  ws.on('message', (data) => {
    msgs.push(JSON.parse(data.toString()) as Record<string, unknown>)
  })
  return { msgs }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

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
  // user found, character not found
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
          assert.equal(mock.realtimeInputs[0]!.media.data, 'AAAA')
          assert.equal(mock.realtimeInputs[0]!.media.mimeType, 'audio/pcm;rate=16000')
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
        // Fire a toolCall with get_current_time (always in tool list, no DB needed)
        mock.triggerMessage({
          toolCall: {
            functionCalls: [{ id: 'call-1', name: 'get_current_time', args: {} }],
          },
        })
      }
      if (msg.type === 'tool_start') events.push(`start:${msg.name}`)
      if (msg.type === 'tool_end') {
        events.push(`end:${msg.name}`)
        // Check sendToolResponse was called
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

test('billing tick with INSUFFICIENT_CREDITS sends usage_snapshot(0) + error + closes', async () => {
  const db = makeMockDb([[mockUser], [mockCharacter]])
  let spendCount = 0
  const cs = {
    ...mockCreditService,
    spendCredit: async (): Promise<string> => {
      spendCount++
      throw new Error('INSUFFICIENT_CREDITS')
    },
  }
  const mock = makeMockLiveConnect()
  const { server, close } = createLiveTestServer({
    db,
    creditService: cs,
    verifyToken: async () => ({ uid: 'uid' }),
    liveConnect: mock.connect,
    billingIntervalMs: 80,  // fires quickly in test
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
      // Give the close handler a tick to run
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

// ── Upgrade routing integration test ─────────────────────────────────────────

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

  // Test /agent/stream works
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

  // Test /agent/live works
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
```

- [ ] **Step 2: Build and verify tests fail (handler file does not exist)**

```bash
cd cloud-agent && npm run build 2>&1 | grep -E "error TS|wsLiveAgentHandler" | head -10
```

Expected: TypeScript errors about `wsLiveAgentHandler.js` not found

---

## Task 4: Implement `wsLiveAgentHandler.ts`

**Files:**
- Create: `cloud-agent/src/handlers/wsLiveAgentHandler.ts`

- [ ] **Step 1: Create the handler**

Create `cloud-agent/src/handlers/wsLiveAgentHandler.ts`:

```typescript
import { WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import admin from 'firebase-admin'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { GoogleGenAI } from '@google/genai'
import type { DrizzleClient } from '../db/client.js'
import { users, characters } from '../db/schema.js'
import { embedText } from '../db/embeddings.js'
import { assembleSystemInstruction } from '../services/agentCore.js'
import { buildLiveTools, resolveVoice } from '../services/liveToolAdapter.js'
import { createCreditService } from '../services/creditService.js'
import type { CreditService } from '../services/creditService.js'

type GeminiSession = {
  sendRealtimeInput(input: { media: { data: string; mimeType: string } }): void
  sendToolResponse(response: {
    functionResponses: Array<{ id: string; name: string; response: { output: unknown } }>
  }): void
  close(): void
}

type LiveConnectCfg = {
  model: string
  callbacks: { onmessage: (msg: unknown) => void; onclose: () => void }
  config: unknown
}

const liveAuthSchema = z.object({
  type: z.literal('auth'),
  token: z.string().min(1),
  characterId: z.string().uuid(),
})

export interface WsLiveHandlerOptions {
  db: DrizzleClient
  creditService?: CreditService
  verifyToken?: (token: string) => Promise<{ uid: string }>
  liveConnect?: (cfg: LiveConnectCfg) => Promise<GeminiSession>
  billingIntervalMs?: number
  _clearInterval?: (id: ReturnType<typeof setInterval> | undefined) => void
}

const AUTH_TIMEOUT_MS = 5000

async function defaultLiveConnect(cfg: LiveConnectCfg): Promise<GeminiSession> {
  const project = [
    process.env.GCLOUD_PROJECT,
    process.env.GCP_PROJECT,
    process.env.GOOGLE_CLOUD_PROJECT,
  ].map((v) => v?.trim()).find((v): v is string => Boolean(v))
  if (!project) throw new Error('Missing GCP project env for Gemini Live')
  const location = process.env.GOOGLE_CLOUD_LOCATION?.trim() || 'us-central1'
  const ai = new GoogleGenAI({ vertexai: true, project, location })
  return ai.live.connect(cfg as Parameters<typeof ai.live.connect>[0]) as Promise<GeminiSession>
}

export async function handleLiveWsUpgrade(
  ws: WebSocket,
  req: IncomingMessage,
  options: WsLiveHandlerOptions,
): Promise<void> {
  const { db } = options
  const cs = options.creditService ?? createCreditService(db)
  const verifyToken = options.verifyToken ??
    ((token: string) => admin.auth().verifyIdToken(token).then((d) => ({ uid: d.uid })))
  const liveConnect = options.liveConnect ?? defaultLiveConnect
  const billingIntervalMs = options.billingIntervalMs ?? 60_000
  const clearIntervalFn = options._clearInterval ?? clearInterval

  const timezone = typeof req.headers['x-timezone'] === 'string'
    ? req.headers['x-timezone'].trim()
    : 'UTC'

  let billingTimer: ReturnType<typeof setInterval> | null = null
  let geminiSession: GeminiSession | null = null
  let isAuthenticated = false
  let userId: string | null = null
  let toolExecutors = new Map<string, (args: unknown) => Promise<unknown>>()

  function clearAndClose(): void {
    if (billingTimer !== null) {
      clearIntervalFn(billingTimer)
      billingTimer = null
    }
    try { geminiSession?.close() } catch { /* ignore */ }
    try {
      if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'Session ended')
    } catch { /* ignore */ }
  }

  const authTimer = setTimeout(() => {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'error', code: 'UNAUTHORIZED', message: 'Auth timeout' }))
      }
    } catch { /* ignore */ }
    ws.close(4001, 'Auth timeout')
  }, AUTH_TIMEOUT_MS)

  function handleGeminiMessage(msg: unknown): void {
    const m = msg as {
      serverContent?: {
        modelTurn?: { parts?: Array<{ inlineData?: { data: string } }> }
        outputTranscription?: { text?: string }
        inputTranscription?: { text?: string }
        interrupted?: boolean
      }
      toolCall?: {
        functionCalls?: Array<{ id: string; name: string; args?: unknown }>
      }
    }

    if (m.serverContent) {
      const sc = m.serverContent
      if (sc.modelTurn?.parts) {
        for (const part of sc.modelTurn.parts) {
          if (part.inlineData?.data) {
            try {
              ws.send(JSON.stringify({ type: 'audio_output', data: part.inlineData.data }))
            } catch { /* ignore */ }
          }
        }
      }
      if (sc.outputTranscription?.text) {
        try {
          ws.send(JSON.stringify({ type: 'transcript_token', role: 'model', text: sc.outputTranscription.text }))
        } catch { /* ignore */ }
      }
      if (sc.inputTranscription?.text) {
        try {
          ws.send(JSON.stringify({ type: 'transcript_token', role: 'user', text: sc.inputTranscription.text }))
        } catch { /* ignore */ }
      }
      if (sc.interrupted) {
        try { ws.send(JSON.stringify({ type: 'audio_interrupted' })) } catch { /* ignore */ }
      }
    }

    if (m.toolCall?.functionCalls?.length) {
      void handleToolCalls(m.toolCall.functionCalls)
    }
  }

  function handleGeminiClose(): void {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'error',
          code: 'GEMINI_DISCONNECTED',
          message: 'Upstream connection lost',
        }))
      }
    } catch { /* ignore */ }
    clearAndClose()
  }

  async function handleToolCalls(
    calls: Array<{ id: string; name: string; args?: unknown }>,
  ): Promise<void> {
    for (const call of calls) {
      try { ws.send(JSON.stringify({ type: 'tool_start', name: call.name })) } catch { /* ignore */ }

      let result: unknown
      try {
        const executor = toolExecutors.get(call.name)
        if (!executor) throw new Error(`Unknown tool: ${call.name}`)
        result = await executor(call.args ?? {})
      } catch (err) {
        result = { error: err instanceof Error ? err.message : 'Tool execution failed' }
      }

      geminiSession?.sendToolResponse({
        functionResponses: [{ id: call.id, name: call.name, response: { output: result } }],
      })

      try { ws.send(JSON.stringify({ type: 'tool_end', name: call.name })) } catch { /* ignore */ }
    }
  }

  async function handleAuthMessage(data: WebSocket.RawData): Promise<void> {
    clearTimeout(authTimer)

    try {
      const parseResult = liveAuthSchema.safeParse(JSON.parse(data.toString()))
      if (!parseResult.success) {
        ws.send(JSON.stringify({ type: 'error', code: 'UNAUTHORIZED', message: 'Invalid auth payload' }))
        ws.close(4001, 'Invalid auth payload')
        return
      }

      const { token, characterId } = parseResult.data

      let uid: string
      try {
        const decoded = await verifyToken(token)
        uid = decoded.uid
      } catch {
        ws.send(JSON.stringify({ type: 'error', code: 'UNAUTHORIZED', message: 'Token verification failed' }))
        ws.close(4001, 'Token verification failed')
        return
      }

      const [dbUser] = await db.select({ id: users.id }).from(users).where(eq(users.firebaseUid, uid))
      if (!dbUser) {
        ws.send(JSON.stringify({ type: 'error', code: 'UNAUTHORIZED', message: 'User not found' }))
        ws.close(4001, 'User not found')
        return
      }
      userId = dbUser.id

      const balance = await cs.getBalance(userId)
      if (balance <= 0) {
        ws.send(JSON.stringify({ type: 'error', code: 'INSUFFICIENT_CREDITS', message: 'Insufficient credits' }))
        ws.close(4402, 'Insufficient credits')
        return
      }

      const [character] = await db
        .select()
        .from(characters)
        .where(and(eq(characters.id, characterId), eq(characters.userId, userId)))
      if (!character) {
        ws.send(JSON.stringify({ type: 'error', code: 'CHARACTER_NOT_FOUND', message: 'Character not found' }))
        ws.close(4404, 'Character not found')
        return
      }

      const voiceName = resolveVoice(character.voice)
      const { declarations, executors } = buildLiveTools(db, userId, characterId, embedText, timezone)
      toolExecutors = executors

      const systemInstruction = assembleSystemInstruction(character, '')

      try {
        geminiSession = await liveConnect({
          model: 'gemini-2.5-flash-preview-native-audio-dialog',
          callbacks: { onmessage: handleGeminiMessage, onclose: handleGeminiClose },
          config: {
            systemInstruction,
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
            tools: [{ functionDeclarations: declarations }, { googleSearch: {} }],
            responseModalities: ['AUDIO'],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        })
      } catch {
        ws.send(JSON.stringify({ type: 'error', code: 'GEMINI_UNAVAILABLE', message: 'Failed to connect to Gemini' }))
        ws.close(1011, 'Gemini unavailable')
        return
      }

      billingTimer = setInterval(() => {
        void (async () => {
          try {
            await cs.spendCredit(userId!)
            let newBalance: number
            try {
              newBalance = await cs.getBalance(userId!)
            } catch {
              return
            }
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'usage_snapshot', remainingCredits: newBalance }))
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : ''
            if (msg === 'INSUFFICIENT_CREDITS') {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'usage_snapshot', remainingCredits: 0 }))
                ws.send(JSON.stringify({ type: 'error', code: 'INSUFFICIENT_CREDITS', message: 'Insufficient credits' }))
              }
              clearAndClose()
            } else {
              console.error('[live billing] unexpected spendCredit error:', err)
            }
          }
        })()
      }, billingIntervalMs)

      isAuthenticated = true
      ws.send(JSON.stringify({ type: 'session_ready', remainingCredits: balance }))
    } catch (err) {
      console.error('Live auth error:', err)
      try {
        ws.send(JSON.stringify({ type: 'error', code: 'UNAUTHORIZED', message: 'Internal auth error' }))
      } catch { /* ignore */ }
      ws.close(4001, 'Auth error')
    }
  }

  async function handleLiveMessage(data: WebSocket.RawData): Promise<void> {
    try {
      const payload = JSON.parse(data.toString()) as { type: string; data?: string }
      switch (payload.type) {
        case 'audio_input':
          if (payload.data && geminiSession) {
            geminiSession.sendRealtimeInput({
              media: { data: payload.data, mimeType: 'audio/pcm;rate=16000' },
            })
          }
          break
        case 'end_session':
          try { ws.send(JSON.stringify({ type: 'session_ended' })) } catch { /* ignore */ }
          clearAndClose()
          break
        default:
          break
      }
    } catch { /* ignore malformed messages */ }
  }

  let messageChain = Promise.resolve()
  ws.on('message', (data) => {
    messageChain = messageChain.then(async () => {
      if (!isAuthenticated) {
        await handleAuthMessage(data)
      } else {
        await handleLiveMessage(data)
      }
    }).catch((err) => {
      console.error('Live WS message error:', err)
    })
  })

  ws.on('close', () => {
    clearTimeout(authTimer)
    clearAndClose()
  })

  ws.on('error', (err) => {
    console.error('Live WebSocket error:', err)
    clearTimeout(authTimer)
  })
}
```

- [ ] **Step 2: Build**

```bash
cd cloud-agent && npm run build 2>&1 | grep "error TS" | head -20
```

Expected: no errors

- [ ] **Step 3: Run tests — verify handler tests pass**

```bash
cd cloud-agent && npm test 2>&1 | grep -E "wsLiveAgentHandler|PASS|FAIL" | head -30
```

Expected: all wsLiveAgentHandler tests pass (skip the routing test for now — needs index.ts changes)

- [ ] **Step 4: Commit**

```bash
git add cloud-agent/src/handlers/wsLiveAgentHandler.ts cloud-agent/src/handlers/wsLiveAgentHandler.test.ts
git commit -m "feat(live-voice): add wsLiveAgentHandler with auth, billing, tool intercept"
```

---

## Task 5: Refactor `index.ts` — centralized `attachWebSocketRoutes`

**Files:**
- Modify: `cloud-agent/src/index.ts`

The current `attachAgentStreamWebSocket` has an `else { socket.destroy() }` branch that would destroy `/agent/live` upgrade requests. Replace it with a single router.

- [ ] **Step 1: Update `AppOptions` and add `attachWebSocketRoutes`**

In `cloud-agent/src/index.ts`:

1. Add import at the top (after existing imports):
```typescript
import { handleLiveWsUpgrade, type WsLiveHandlerOptions } from './handlers/wsLiveAgentHandler.js'
```

2. Update `AppOptions` interface to include `wsLiveHandlerOptions`:
```typescript
interface AppOptions {
  verifyToken: (token: string) => Promise<{ uid: string }>
  db: DrizzleClient
  runAgentFn: (params: RunAgentParams) => Promise<{ reply: string; toolCalls: string[]; groundingMetadata?: GroundingMetadata }>
  creditService?: CreditService
  wsHandlerOptions?: Partial<WsHandlerOptions>
  wsLiveHandlerOptions?: Partial<WsLiveHandlerOptions>
}
```

3. Add `attachWebSocketRoutes` function (after `attachAgentStreamWebSocket`):
```typescript
export function attachWebSocketRoutes(server: Server, options: AppOptions): void {
  const { verifyToken, db, wsHandlerOptions, wsLiveHandlerOptions, creditService } = options
  const streamWss = new WebSocketServer({ noServer: true })
  const liveWss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url ?? '', `http://${req.headers.host}`).pathname

    if (pathname === '/agent/stream') {
      streamWss.handleUpgrade(req, socket, head, (ws) => {
        void handleWsUpgrade(ws, req, { db, verifyToken, creditService, ...wsHandlerOptions })
      })
    } else if (pathname === '/agent/live') {
      liveWss.handleUpgrade(req, socket, head, (ws) => {
        void handleLiveWsUpgrade(ws, req, { db, verifyToken, creditService, ...wsLiveHandlerOptions })
      })
    } else {
      socket.destroy()
    }
  })
}
```

4. In the entry point block at the bottom, replace:
```typescript
attachAgentStreamWebSocket(server, appOptions)
```
with:
```typescript
attachWebSocketRoutes(server, appOptions)
```

(`attachAgentStreamWebSocket` can remain exported for backwards compat but is no longer called from the entry point.)

- [ ] **Step 2: Build**

```bash
cd cloud-agent && npm run build 2>&1 | grep "error TS" | head -20
```

Expected: no errors

- [ ] **Step 3: Run full test suite**

```bash
cd cloud-agent && npm test 2>&1 | grep -E "PASS|FAIL|error" | head -40
```

Expected: all tests pass including routing test in wsLiveAgentHandler.test.ts

- [ ] **Step 4: Commit**

```bash
git add cloud-agent/src/index.ts
git commit -m "feat(live-voice): add attachWebSocketRoutes for unified /agent/stream + /agent/live routing"
```

---

## Task 6: Frontend — replace `GEMINI_VOICES` with `GEMINI_LIVE_VOICES`

**Files:**
- Modify: `src/constants/geminiVoices.ts`
- Modify: `app/(drawer)/(tabs)/characters/[id]/edit.tsx`

- [ ] **Step 1: Update `geminiVoices.ts`**

Replace the entire contents of `src/constants/geminiVoices.ts` with:

```typescript
export { DEFAULT_VOICE, normalizeVoice } from './voiceDefaults'

export const GEMINI_LIVE_VOICES = ['Aoede', 'Charon', 'Fenrir', 'Kore', 'Puck'] as const
export type GeminiLiveVoice = typeof GEMINI_LIVE_VOICES[number]
```

(Removes the 30-voice `GeminiVoice` interface and `GEMINI_VOICES` array. The `DEFAULT_VOICE` and `normalizeVoice` re-exports are preserved — other parts of the app still use them.)

- [ ] **Step 2: Update `edit.tsx` import**

In `app/(drawer)/(tabs)/characters/[id]/edit.tsx`, change line 30:

From:
```typescript
import { DEFAULT_VOICE, GEMINI_VOICES } from '~/constants/geminiVoices'
```

To:
```typescript
import { DEFAULT_VOICE, GEMINI_LIVE_VOICES } from '~/constants/geminiVoices'
```

- [ ] **Step 3: Update the voice button label (line ~447)**

Change the button anchor content from:
```typescript
{(() => {
  const style = GEMINI_VOICES.find((v) => v.name === voice)?.style
  return style ? `${voice} — ${style}` : voice
})()}
```

To:
```typescript
{voice}
```

(The 5 Live API voices have no style descriptor; just show the name.)

- [ ] **Step 4: Update the voice menu items (line ~453)**

Change:
```typescript
{GEMINI_VOICES.map((v) => (
  <Menu.Item
    key={v.name}
    title={`${v.name} — ${v.style}`}
    onPress={() => {
      setVoice(v.name)
      setVoiceMenuVisible(false)
    }}
  />
))}
```

To:
```typescript
{GEMINI_LIVE_VOICES.map((v) => (
  <Menu.Item
    key={v}
    title={v}
    onPress={() => {
      setVoice(v)
      setVoiceMenuVisible(false)
    }}
  />
))}
```

- [ ] **Step 5: Run TypeScript check on frontend**

```bash
npx tsc --noEmit 2>&1 | grep -E "error TS|geminiVoices|edit.tsx" | head -20
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/constants/geminiVoices.ts "app/(drawer)/(tabs)/characters/[id]/edit.tsx"
git commit -m "feat(live-voice): replace 30-voice TTS list with 5-voice GEMINI_LIVE_VOICES constant"
```

---

## Task 7: Final verification

- [ ] **Step 1: Run full cloud-agent test suite**

```bash
cd cloud-agent && npm test
```

Expected: all tests pass — liveToolAdapter, wsLiveAgentHandler (including routing test), plus all pre-existing tests (index, wsAgentHandler, tools, creditService)

- [ ] **Step 2: Run frontend typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Review acceptance criteria from spec**

Open `docs/superpowers/specs/2026-06-26-live-voice-backend-design.md` Section 14 and verify each item:

- `/agent/live` rejects unauthenticated connections within 5s → auth timeout test covers this
- Zero-credit users receive 4402 → zero credits test covers this
- `session_ready` only after Gemini bidi established → handler sends it only after `liveConnect()` resolves
- 16kHz PCM audio → MIME type test covers this
- User/model transcripts → `inputTranscription`/`outputTranscription` forwarded in `handleGeminiMessage`
- Barge-in → `sc.interrupted` branch sends `audio_interrupted`
- Tool calls → tool intercept test covers full sequence
- 1 credit per 60s → billing loop runs on `billingIntervalMs`
- Credit exhaustion → billing INSUFFICIENT_CREDITS test covers this
- Timer cleared on all close paths → timer cleared in `clearAndClose()`, tested by client-close test
- Legacy voice names → `resolveVoice` maps unknowns to `'Aoede'`, tested in unit tests
- Voice picker shows 5 voices → `GEMINI_LIVE_VOICES` has 5 entries, picker iterates it
- Existing endpoints unaffected → routing test confirms both routes work; no existing handler files changed

- [ ] **Step 4: Commit any final fixes, then create PR**

```bash
git push origin feat/live-voice-backend
```

---

## Self-Review Notes

**Spec coverage gaps checked:**
- `ai.live.connect()` failure → `GEMINI_UNAVAILABLE` 1011 — covered in handler but no explicit test. Add if CI requires it.
- `audio_interrupted` forwarding — no explicit integration test (triggers via mock Gemini message). Can add if desired.
- Transient billing DB errors (non-INSUFFICIENT_CREDITS) — covered by `console.error` branch; no test needed per spec.

**Placeholder scan:** No TBDs or incomplete steps found.

**Type consistency:**
- `resolveVoice` returns `string` used by `voiceName` in `handleAuthMessage` ✓
- `buildLiveTools` returns `LiveToolSet` with `declarations: FunctionDeclaration[]` used in `liveConnect` config ✓
- `toolExecutors` is `Map<string, (args: unknown) => Promise<unknown>>` used identically in both the auth setup and `handleToolCalls` ✓
- `WsLiveHandlerOptions` `liveConnect` type matches `defaultLiveConnect` signature ✓
- `AppOptions.wsLiveHandlerOptions` type is `Partial<WsLiveHandlerOptions>` spread into `handleLiveWsUpgrade` call ✓
