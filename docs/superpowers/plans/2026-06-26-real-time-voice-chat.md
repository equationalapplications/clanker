# Real-Time Voice Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `useVoiceChat` (expo-speech-recognition, walkie-talkie model) with a continuous Gemini Live API audio stream via XState v5 machine + composable hooks.

**Architecture:** XState `liveVoiceMachine` orchestrates the session lifecycle (pre-call wikiSync, WebSocket connection, transcript accumulation, DB persistence). `useLiveAudioIO` handles hardware I/O (16 kHz recording → base64 chunks, 24 kHz PCM playback queue). `useLiveVoiceChat` is a thin controller that wires the machine and audio hook together and exposes derived state to the Talk tab.

**Tech Stack:** XState v5 (`createMachine`, `fromPromise`, `fromCallback`, `sendTo`), `@xstate/react` v6 (`useMachine`), `expo-audio`, `react-native-live-audio-stream`, existing `wikiSync` Firebase callable, existing `saveAIMessage` SQLite helper.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| CREATE | `src/machines/liveVoiceMachine.ts` | Session lifecycle (sync → connect → live → save → idle), WebSocket actor, transcript accumulation |
| CREATE | `src/hooks/useLiveAudioIO.ts` | Hardware primitive: mic recording, PCM playback queue, barge-in flush |
| CREATE | `src/hooks/useLiveVoiceChat.ts` | Controller: wires machine + audio hook, exposes `startCall`/`endCall`/`cancelCall` |
| MODIFY | `app/(drawer)/(tabs)/talk/index.tsx` | Replace `useVoiceChat` with `useLiveVoiceChat`, update state derivation + UI |
| CREATE | `__tests__/liveVoiceMachine.test.ts` | Pure Node.js XState tests (no RN mocking needed) |
| CREATE | `__tests__/useLiveAudioIO.test.tsx` | Hook tests with RN mocks |
| CREATE | `__tests__/useLiveVoiceChat.test.tsx` | Controller hook tests |

---

## Task 1: Install react-native-live-audio-stream

**Files:**
- Modify: `package.json` (via npm install)

- [ ] **Step 1: Install the package**

```bash
cd /Users/equationalapplications/code/src/github.com/equationalapplications/clanker
npm install react-native-live-audio-stream
```

Expected: Package added to `dependencies` in `package.json`.

- [ ] **Step 2: Verify Expo config recognises native module**

```bash
npx expo install --check
```

Expected: No warnings about unlinked native modules. If `expo install` recommends a version, use that instead.

- [ ] **Step 3: Add to app.config.ts plugins if required**

Open `app.config.ts`. If `plugins` array exists, check whether `react-native-live-audio-stream` needs an entry. The library uses no special Expo config plugin — native linking is automatic via Expo Modules on SDK 50+. No change needed unless a build error appears.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install react-native-live-audio-stream for PCM mic streaming"
```

---

## Task 2: Create the liveVoiceMachine (idle → syncing_memory → session)

**Files:**
- Create: `src/machines/liveVoiceMachine.ts`
- Create: `__tests__/liveVoiceMachine.test.ts`

- [ ] **Step 1: Write failing tests for idle → syncing_memory → connecting**

Create `__tests__/liveVoiceMachine.test.ts`:

```typescript
jest.mock('~/services/wikiService', () => ({
  getWiki: jest.fn(),
}))
jest.mock('~/services/apiClient', () => ({
  wikiSync: jest.fn(),
}))
jest.mock('~/database/messageDatabase', () => ({
  saveAIMessage: jest.fn(),
  sendMessage: jest.fn(),
}))
jest.mock('~/config/firebaseConfig', () => ({
  getCurrentUser: jest.fn(),
}))

import { createActor, waitFor } from 'xstate'
import { liveVoiceMachine } from '~/machines/liveVoiceMachine'
import { getWiki } from '~/services/wikiService'
import { wikiSync } from '~/services/apiClient'
import { getCurrentUser } from '~/config/firebaseConfig'

const WAIT = { timeout: 3000 }

function makeWikiMock() {
  return {
    exportDump: jest.fn().mockResolvedValue({ generatedAt: 0, entities: {} }),
    importDump: jest.fn().mockResolvedValue(undefined),
  }
}

function makeUserMock(token = 'test-token') {
  return { getIdToken: jest.fn().mockResolvedValue(token) }
}

function spawnMachine(overrides: Record<string, unknown> = {}) {
  return createActor(liveVoiceMachine, {
    input: { characterId: 'char1', userId: 'user1', initialCredits: 10, ...overrides },
  }).start()
}

describe('liveVoiceMachine', () => {
  let actors: ReturnType<typeof spawnMachine>[] = []

  afterEach(() => {
    actors.forEach((a) => a.stop())
    actors.length = 0
    jest.clearAllMocks()
  })

  function spawn(overrides: Record<string, unknown> = {}) {
    const actor = spawnMachine(overrides)
    actors.push(actor)
    return actor
  }

  test('starts in idle', () => {
    const actor = spawn()
    expect(actor.getSnapshot().matches('idle')).toBe(true)
  })

  test('START_CALL → syncing_memory and calls wiki.exportDump + wikiSync', async () => {
    const wiki = makeWikiMock()
    jest.mocked(getWiki).mockReturnValue(wiki as never)
    jest.mocked(wikiSync).mockResolvedValue({ data: { remoteDump: { generatedAt: 0, entities: {} } } } as never)
    jest.mocked(getCurrentUser).mockReturnValue(makeUserMock() as never)

    const actor = spawn()
    actor.send({ type: 'START_CALL' })

    await waitFor(actor, (s) => s.matches({ session: 'connecting' }), WAIT)

    expect(wiki.exportDump).toHaveBeenCalledWith(['char1'])
    expect(wikiSync).toHaveBeenCalled()
  })

  test('failed wikiSync → error state', async () => {
    const wiki = makeWikiMock()
    jest.mocked(getWiki).mockReturnValue(wiki as never)
    jest.mocked(wikiSync).mockRejectedValue(new Error('sync failed'))

    const actor = spawn()
    actor.send({ type: 'START_CALL' })

    await waitFor(actor, (s) => s.matches('error'), WAIT)
    expect(actor.getSnapshot().context.socketError).toBe('sync failed')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest __tests__/liveVoiceMachine.test.ts --no-coverage
```

Expected: `Cannot find module '~/machines/liveVoiceMachine'`

- [ ] **Step 3: Create liveVoiceMachine.ts with idle + syncing_memory + session/connecting states**

Create `src/machines/liveVoiceMachine.ts`:

```typescript
import { createMachine, assign, fromPromise, fromCallback, sendTo } from 'xstate'
import type { IMessage } from 'react-native-gifted-chat'
import { getWiki } from '~/services/wikiService'
import { wikiSync } from '~/services/apiClient'
import type { WikiSyncDump } from '~/services/apiClient'
import { saveAIMessage, sendMessage } from '~/database/messageDatabase'
import { getCurrentUser } from '~/config/firebaseConfig'

function getLiveWsUrl(): string {
  const baseUrl = process.env.EXPO_PUBLIC_CLOUD_AGENT_URL?.trim()
  if (!baseUrl) throw new Error('EXPO_PUBLIC_CLOUD_AGENT_URL is not configured')
  return (
    baseUrl
      .replace(/\/agent\/(run|stream)\/?$/, '')
      .replace(/\/$/, '')
      .replace(/^https?/, (m) => (m === 'https' ? 'wss' : 'ws')) + '/agent/live'
  )
}

export interface LiveVoiceMachineContext {
  characterId: string
  userId: string
  transcript: IMessage[]
  activeTool: string | null
  remainingCredits: number
  socketError: string | null
  retryCount: number
}

export type LiveVoiceEvent =
  | { type: 'START_CALL' }
  | { type: 'AUDIO_INPUT'; data: string }
  | { type: 'END_CALL' }
  | { type: 'RETRY' }
  | { type: 'SOCKET_OPENED' }
  | { type: 'AUDIO_OUTPUT'; data: string }
  | { type: 'TRANSCRIPT_TOKEN'; role: 'user' | 'model'; text: string }
  | { type: 'TOOL_START'; name: string }
  | { type: 'TOOL_END'; name: string }
  | { type: 'USAGE_SNAPSHOT'; remainingCredits: number }
  | { type: 'AUDIO_INTERRUPTED' }
  | { type: 'SESSION_ENDED' }
  | { type: 'SOCKET_ERROR'; message: string }
  | { type: 'SOCKET_CLOSED' }
  | { type: 'SEND_END_SESSION' }

export interface LiveVoiceMachineInput {
  characterId: string
  userId: string
  initialCredits?: number
}

const MAX_RETRIES = 5
const RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000]

export const liveVoiceMachine = createMachine(
  {
    id: 'liveVoiceMachine',
    types: {} as {
      context: LiveVoiceMachineContext
      events: LiveVoiceEvent
      input: LiveVoiceMachineInput
    },
    initial: 'idle',
    context: ({ input }) => ({
      characterId: input.characterId,
      userId: input.userId,
      transcript: [],
      activeTool: null,
      remainingCredits: input.initialCredits ?? 0,
      socketError: null,
      retryCount: 0,
    }),
    states: {
      idle: {
        on: {
          START_CALL: { target: 'syncing_memory' },
        },
      },

      syncing_memory: {
        invoke: {
          src: 'syncMemoryActor',
          input: ({ context }) => ({ characterId: context.characterId }),
          onDone: { target: 'session' },
          onError: {
            target: 'error',
            actions: assign({
              socketError: ({ event }) =>
                event.error instanceof Error ? event.error.message : 'Memory sync failed',
            }),
          },
        },
      },

      session: {
        invoke: {
          id: 'websocket',
          src: 'websocketActor',
          input: ({ context }) => ({ characterId: context.characterId }),
        },
        initial: 'connecting',
        on: {
          SOCKET_ERROR: {
            target: 'error',
            actions: assign({ socketError: ({ event }) => event.message }),
          },
          SOCKET_CLOSED: {
            target: 'error',
            actions: assign({ socketError: () => 'Connection lost' }),
          },
        },
        states: {
          connecting: {
            on: {
              SOCKET_OPENED: { target: 'live' },
            },
          },
          live: {
            on: {
              AUDIO_INPUT: {
                actions: sendTo('websocket', ({ event }) => event),
              },
              AUDIO_OUTPUT: {
                actions: 'playIncomingAudio',
              },
              AUDIO_INTERRUPTED: {
                actions: 'flushAudioPlayback',
              },
              TRANSCRIPT_TOKEN: {
                actions: 'accumulateTranscript',
              },
              TOOL_START: {
                actions: assign({ activeTool: ({ event }) => event.name }),
              },
              TOOL_END: {
                actions: assign({ activeTool: () => null }),
              },
              USAGE_SNAPSHOT: [
                {
                  guard: ({ event }) => event.remainingCredits <= 0,
                  target: '#liveVoiceMachine.saving_to_db',
                  actions: assign({
                    remainingCredits: () => 0,
                    socketError: () => 'credit_exhausted',
                  }),
                },
                {
                  actions: assign({
                    remainingCredits: ({ event }) => event.remainingCredits,
                  }),
                },
              ],
              END_CALL: {
                target: '#liveVoiceMachine.saving_to_db',
                actions: sendTo('websocket', { type: 'SEND_END_SESSION' } as LiveVoiceEvent),
              },
            },
          },
        },
      },

      saving_to_db: {
        invoke: {
          src: 'saveTranscriptActor',
          input: ({ context }) => ({
            characterId: context.characterId,
            userId: context.userId,
            transcript: context.transcript,
          }),
          onDone: {
            target: 'idle',
            actions: assign({ transcript: () => [], activeTool: () => null, socketError: () => null }),
          },
          onError: {
            target: 'idle',
            actions: assign({ transcript: () => [], activeTool: () => null }),
          },
        },
      },

      error: {
        on: {
          RETRY: [
            {
              guard: ({ context }) => context.retryCount < MAX_RETRIES,
              target: 'session',
              actions: assign({
                retryCount: ({ context }) => context.retryCount + 1,
                socketError: () => null,
              }),
            },
          ],
        },
        after: {
          RETRY_DELAY: [
            {
              guard: ({ context }) =>
                context.retryCount < MAX_RETRIES && context.socketError !== 'credit_exhausted',
              target: 'session',
              actions: assign({
                retryCount: ({ context }) => context.retryCount + 1,
                socketError: () => null,
              }),
            },
          ],
        },
      },
    },
  },
  {
    actions: {
      accumulateTranscript: assign({
        transcript: ({ context, event }) => {
          if (event.type !== 'TRANSCRIPT_TOKEN') return context.transcript
          const { role, text } = event
          const msgUserId = role === 'user' ? context.userId : context.characterId
          const last = context.transcript[context.transcript.length - 1]
          if (last && last.user._id === msgUserId) {
            const updated = [...context.transcript]
            updated[updated.length - 1] = { ...last, text: last.text + text }
            return updated
          }
          return [
            ...context.transcript,
            {
              _id: `live_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              text,
              createdAt: new Date(),
              user: { _id: msgUserId },
            },
          ]
        },
      }),
      // Injected by controller hook - these are no-ops in the machine definition
      playIncomingAudio: () => {},
      flushAudioPlayback: () => {},
    },
    guards: {},
    delays: {
      RETRY_DELAY: ({ context }) =>
        RETRY_DELAYS_MS[Math.min(context.retryCount, RETRY_DELAYS_MS.length - 1)],
    },
    actors: {
      syncMemoryActor: fromPromise(
        async ({ input }: { input: { characterId: string } }) => {
          const wiki = getWiki()
          const local = await wiki.exportDump([input.characterId])
          const result = await wikiSync({ dump: local as WikiSyncDump })
          const remoteDump = result.data.remoteDump
          if (remoteDump && Object.keys(remoteDump.entities ?? {}).length > 0) {
            await wiki.importDump(remoteDump as Parameters<typeof wiki.importDump>[0], { merge: true })
          }
        },
      ),

      websocketActor: fromCallback<LiveVoiceEvent, { characterId: string }>(
        ({ sendBack, receive }) => {
          let ws: WebSocket | null = null
          let cleanedUp = false

          const cleanup = () => {
            cleanedUp = true
            ws?.close()
            ws = null
          }

          getCurrentUser()
            ?.getIdToken()
            .then((token) => {
              if (cleanedUp) return
              if (!token) {
                sendBack({ type: 'SOCKET_ERROR', message: 'No authenticated user' })
                return
              }
              const url = getLiveWsUrl()
              ws = new WebSocket(url)

              ws.onopen = () => {
                ws!.send(JSON.stringify({ type: 'auth', token }))
                sendBack({ type: 'SOCKET_OPENED' })
              }

              ws.onmessage = (event) => {
                try {
                  const msg = JSON.parse(event.data as string) as { type: string } & Record<string, unknown>
                  const xstateType =
                    msg.type === 'error' ? 'SOCKET_ERROR' : msg.type.toUpperCase()
                  sendBack({ ...msg, type: xstateType } as LiveVoiceEvent)
                } catch {
                  // ignore malformed messages
                }
              }

              ws.onerror = () => {
                if (!cleanedUp) sendBack({ type: 'SOCKET_ERROR', message: 'WebSocket connection error' })
              }

              ws.onclose = () => {
                if (!cleanedUp) sendBack({ type: 'SOCKET_CLOSED' })
              }
            })
            .catch(() => {
              if (!cleanedUp) sendBack({ type: 'SOCKET_ERROR', message: 'Failed to retrieve auth token' })
            })

          receive((event) => {
            if (!ws || ws.readyState !== WebSocket.OPEN) return
            if (event.type === 'AUDIO_INPUT') {
              ws.send(JSON.stringify({ type: 'audio_input', data: event.data }))
            } else if (event.type === 'SEND_END_SESSION') {
              ws.send(JSON.stringify({ type: 'end_session' }))
            }
          })

          return cleanup
        },
      ),

      saveTranscriptActor: fromPromise(
        async ({
          input,
        }: {
          input: { characterId: string; userId: string; transcript: IMessage[] }
        }) => {
          const { characterId, userId, transcript } = input
          for (const msg of transcript) {
            const isAI = msg.user._id !== userId
            if (isAI) {
              // Fire-and-forget: do not await, component may be unmounted
              void saveAIMessage(
                characterId,
                userId,
                msg.text,
                String(msg._id),
                { user: msg.user, createdAt: msg.createdAt },
                Date.now(),
              )
            } else {
              void sendMessage(characterId, userId, msg.text, String(msg._id))
            }
          }
        },
      ),
    },
  },
)
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest __tests__/liveVoiceMachine.test.ts --no-coverage
```

Expected:
```
PASS __tests__/liveVoiceMachine.test.ts
  liveVoiceMachine
    ✓ starts in idle
    ✓ START_CALL → syncing_memory and calls wiki.exportDump + wikiSync
    ✓ failed wikiSync → error state
```

- [ ] **Step 5: Commit**

```bash
git add src/machines/liveVoiceMachine.ts __tests__/liveVoiceMachine.test.ts
git commit -m "feat: add liveVoiceMachine with sync, session, WebSocket actor"
```

---

## Task 3: liveVoiceMachine — live state (transcript + tools)

**Files:**
- Modify: `__tests__/liveVoiceMachine.test.ts` (add tests)
- Modify: `src/machines/liveVoiceMachine.ts` (already complete — tests verify behavior)

- [ ] **Step 1: Add transcript accumulation + tool state tests**

Append to the `describe` block in `__tests__/liveVoiceMachine.test.ts`:

```typescript
  function advanceToLive(actor: ReturnType<typeof spawn>) {
    // Drive machine to session.live without real WebSocket
    actor.send({ type: 'START_CALL' })
    // Manually simulate sync success → socket opened
    // We wait for connecting then send SOCKET_OPENED
    return waitFor(actor, (s) => s.matches({ session: 'connecting' }), WAIT).then(() => {
      actor.send({ type: 'SOCKET_OPENED' })
      return waitFor(actor, (s) => s.matches({ session: 'live' }), WAIT)
    })
  }

  test('TRANSCRIPT_TOKEN same role concatenates text', async () => {
    const wiki = makeWikiMock()
    jest.mocked(getWiki).mockReturnValue(wiki as never)
    jest.mocked(wikiSync).mockResolvedValue({ data: { remoteDump: { generatedAt: 0, entities: {} } } } as never)
    jest.mocked(getCurrentUser).mockReturnValue(makeUserMock() as never)

    const actor = spawn()
    await advanceToLive(actor)

    actor.send({ type: 'TRANSCRIPT_TOKEN', role: 'model', text: 'Hello' })
    actor.send({ type: 'TRANSCRIPT_TOKEN', role: 'model', text: ' world' })

    const { transcript } = actor.getSnapshot().context
    expect(transcript).toHaveLength(1)
    expect(transcript[0].text).toBe('Hello world')
  })

  test('TRANSCRIPT_TOKEN role switch creates new message', async () => {
    const wiki = makeWikiMock()
    jest.mocked(getWiki).mockReturnValue(wiki as never)
    jest.mocked(wikiSync).mockResolvedValue({ data: { remoteDump: { generatedAt: 0, entities: {} } } } as never)
    jest.mocked(getCurrentUser).mockReturnValue(makeUserMock() as never)

    const actor = spawn()
    await advanceToLive(actor)

    actor.send({ type: 'TRANSCRIPT_TOKEN', role: 'user', text: 'Hi' })
    actor.send({ type: 'TRANSCRIPT_TOKEN', role: 'model', text: 'Hello' })

    const { transcript } = actor.getSnapshot().context
    expect(transcript).toHaveLength(2)
    expect(transcript[0].user._id).toBe('user1')
    expect(transcript[1].user._id).toBe('char1')
  })

  test('TOOL_START sets activeTool, TOOL_END clears it', async () => {
    const wiki = makeWikiMock()
    jest.mocked(getWiki).mockReturnValue(wiki as never)
    jest.mocked(wikiSync).mockResolvedValue({ data: { remoteDump: { generatedAt: 0, entities: {} } } } as never)
    jest.mocked(getCurrentUser).mockReturnValue(makeUserMock() as never)

    const actor = spawn()
    await advanceToLive(actor)

    actor.send({ type: 'TOOL_START', name: 'wiki_read' })
    expect(actor.getSnapshot().context.activeTool).toBe('wiki_read')

    actor.send({ type: 'TOOL_END', name: 'wiki_read' })
    expect(actor.getSnapshot().context.activeTool).toBeNull()
  })

  test('USAGE_SNAPSHOT updates remainingCredits', async () => {
    const wiki = makeWikiMock()
    jest.mocked(getWiki).mockReturnValue(wiki as never)
    jest.mocked(wikiSync).mockResolvedValue({ data: { remoteDump: { generatedAt: 0, entities: {} } } } as never)
    jest.mocked(getCurrentUser).mockReturnValue(makeUserMock() as never)

    const actor = spawn({ initialCredits: 10 })
    await advanceToLive(actor)

    actor.send({ type: 'USAGE_SNAPSHOT', remainingCredits: 7 })
    expect(actor.getSnapshot().context.remainingCredits).toBe(7)
  })

  test('USAGE_SNAPSHOT with 0 credits → saving_to_db', async () => {
    const wiki = makeWikiMock()
    jest.mocked(getWiki).mockReturnValue(wiki as never)
    jest.mocked(wikiSync).mockResolvedValue({ data: { remoteDump: { generatedAt: 0, entities: {} } } } as never)
    jest.mocked(getCurrentUser).mockReturnValue(makeUserMock() as never)

    const { saveAIMessage } = jest.requireMock('~/database/messageDatabase') as { saveAIMessage: jest.Mock }
    saveAIMessage.mockResolvedValue(undefined)

    const actor = spawn({ initialCredits: 1 })
    await advanceToLive(actor)

    actor.send({ type: 'USAGE_SNAPSHOT', remainingCredits: 0 })

    await waitFor(actor, (s) => s.matches('saving_to_db') || s.matches('idle'), WAIT)
    expect(actor.getSnapshot().context.socketError).toBe('credit_exhausted')
  })
```

- [ ] **Step 2: Run tests**

```bash
npx jest __tests__/liveVoiceMachine.test.ts --no-coverage
```

Expected: All tests pass. (The machine implementation is already complete from Task 2.)

- [ ] **Step 3: Commit**

```bash
git add __tests__/liveVoiceMachine.test.ts
git commit -m "test: add liveVoiceMachine transcript + tool state coverage"
```

---

## Task 4: liveVoiceMachine — saving_to_db + error retry

**Files:**
- Modify: `__tests__/liveVoiceMachine.test.ts`

- [ ] **Step 1: Add saving_to_db and retry tests**

Append to the `describe` block:

```typescript
  test('END_CALL → saving_to_db → idle, calls saveAIMessage for model turns', async () => {
    const wiki = makeWikiMock()
    jest.mocked(getWiki).mockReturnValue(wiki as never)
    jest.mocked(wikiSync).mockResolvedValue({ data: { remoteDump: { generatedAt: 0, entities: {} } } } as never)
    jest.mocked(getCurrentUser).mockReturnValue(makeUserMock() as never)

    const { saveAIMessage } = jest.requireMock('~/database/messageDatabase') as { saveAIMessage: jest.Mock }
    saveAIMessage.mockResolvedValue(undefined)

    const actor = spawn()
    await advanceToLive(actor)

    actor.send({ type: 'TRANSCRIPT_TOKEN', role: 'model', text: 'Hello!' })
    actor.send({ type: 'END_CALL' })

    await waitFor(actor, (s) => s.matches('idle'), WAIT)
    // Fire-and-forget: saveAIMessage was called (may be async, use small delay)
    await new Promise((r) => setTimeout(r, 50))
    expect(saveAIMessage).toHaveBeenCalledWith(
      'char1',
      'user1',
      'Hello!',
      expect.any(String),
      expect.objectContaining({ user: expect.objectContaining({ _id: 'char1' }) }),
      expect.any(Number),
    )
    // transcript cleared after save
    expect(actor.getSnapshot().context.transcript).toHaveLength(0)
  })

  test('SOCKET_ERROR → error state with message', async () => {
    const wiki = makeWikiMock()
    jest.mocked(getWiki).mockReturnValue(wiki as never)
    jest.mocked(wikiSync).mockResolvedValue({ data: { remoteDump: { generatedAt: 0, entities: {} } } } as never)
    jest.mocked(getCurrentUser).mockReturnValue(makeUserMock() as never)

    const actor = spawn()
    await advanceToLive(actor)

    actor.send({ type: 'SOCKET_ERROR', message: 'Network unreachable' })

    await waitFor(actor, (s) => s.matches('error'), WAIT)
    expect(actor.getSnapshot().context.socketError).toBe('Network unreachable')
  })

  test('RETRY from error → session.connecting, increments retryCount', async () => {
    const wiki = makeWikiMock()
    jest.mocked(getWiki).mockReturnValue(wiki as never)
    jest.mocked(wikiSync).mockResolvedValue({ data: { remoteDump: { generatedAt: 0, entities: {} } } } as never)
    jest.mocked(getCurrentUser).mockReturnValue(makeUserMock() as never)

    const actor = spawn()
    await advanceToLive(actor)

    actor.send({ type: 'SOCKET_ERROR', message: 'Dropped' })
    await waitFor(actor, (s) => s.matches('error'), WAIT)

    actor.send({ type: 'RETRY' })
    await waitFor(actor, (s) => s.matches({ session: 'connecting' }), WAIT)
    expect(actor.getSnapshot().context.retryCount).toBe(1)
  })
```

- [ ] **Step 2: Run tests**

```bash
npx jest __tests__/liveVoiceMachine.test.ts --no-coverage
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add __tests__/liveVoiceMachine.test.ts
git commit -m "test: add liveVoiceMachine saving_to_db and error retry coverage"
```

---

## Task 5: Build useLiveAudioIO

**Files:**
- Create: `src/hooks/useLiveAudioIO.ts`
- Create: `__tests__/useLiveAudioIO.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `__tests__/useLiveAudioIO.test.tsx`:

```typescript
import React from 'react'
import { act, create } from 'react-test-renderer'

const mockRequestRecordingPermissionsAsync = jest.fn()
const mockSetAudioModeAsync = jest.fn()
const mockCreateAudioPlayer = jest.fn()
const mockRecorderStart = jest.fn()
const mockRecorderStop = jest.fn()
const mockPlayerPlay = jest.fn()
const mockPlayerRelease = jest.fn()
const mockPlayerAddListener = jest.fn()

let mockOnDataCallback: ((data: string) => void) | null = null

jest.mock('expo-audio', () => ({
  requestRecordingPermissionsAsync: (...a: unknown[]) => mockRequestRecordingPermissionsAsync(...a),
  setAudioModeAsync: (...a: unknown[]) => mockSetAudioModeAsync(...a),
  createAudioPlayer: (...a: unknown[]) => mockCreateAudioPlayer(...a),
}))

jest.mock('react-native-live-audio-stream', () => ({
  default: {
    init: jest.fn(),
    start: (...a: unknown[]) => mockRecorderStart(...a),
    stop: (...a: unknown[]) => mockRecorderStop(...a),
    on: (_event: string, cb: (data: string) => void) => {
      mockOnDataCallback = cb
    },
  },
}))

import { useLiveAudioIO } from '~/hooks/useLiveAudioIO'

function TestHarness({ onMount }: { onMount: (hook: ReturnType<typeof useLiveAudioIO>) => void }) {
  const hook = useLiveAudioIO()
  React.useEffect(() => { onMount(hook) }, [])
  return null
}

describe('useLiveAudioIO', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockOnDataCallback = null
    mockSetAudioModeAsync.mockResolvedValue(undefined)
    mockRequestRecordingPermissionsAsync.mockResolvedValue({ granted: true })
    mockRecorderStart.mockReturnValue(undefined)
    mockRecorderStop.mockReturnValue(undefined)
    mockCreateAudioPlayer.mockReturnValue({
      play: mockPlayerPlay,
      release: mockPlayerRelease,
      addListener: mockPlayerAddListener.mockReturnValue({ remove: jest.fn() }),
    })
  })

  test('startRecording requests permissions and starts recorder', async () => {
    let hookRef: ReturnType<typeof useLiveAudioIO> | null = null
    await act(async () => {
      create(<TestHarness onMount={(h) => { hookRef = h }} />)
    })

    await act(async () => {
      await hookRef!.startRecording()
    })

    expect(mockRequestRecordingPermissionsAsync).toHaveBeenCalled()
    expect(mockRecorderStart).toHaveBeenCalled()
    expect(hookRef!.recordingState).toBe('recording')
  })

  test('startRecording with denied permission sets error state', async () => {
    mockRequestRecordingPermissionsAsync.mockResolvedValue({ granted: false })

    let hookRef: ReturnType<typeof useLiveAudioIO> | null = null
    await act(async () => {
      create(<TestHarness onMount={(h) => { hookRef = h }} />)
    })

    await act(async () => {
      await hookRef!.startRecording()
    })

    expect(hookRef!.recordingState).toBe('error')
    expect(hookRef!.error).toMatch(/permission/i)
  })

  test('onAudioChunk fires when recorder emits data', async () => {
    let hookRef: ReturnType<typeof useLiveAudioIO> | null = null
    await act(async () => {
      create(<TestHarness onMount={(h) => { hookRef = h }} />)
    })

    const received: string[] = []
    hookRef!.onAudioChunk((chunk) => received.push(chunk))

    await act(async () => {
      await hookRef!.startRecording()
    })

    act(() => {
      mockOnDataCallback?.('base64audiodata')
    })

    expect(received).toEqual(['base64audiodata'])
  })

  test('clearPlaybackQueue stops player immediately', async () => {
    let hookRef: ReturnType<typeof useLiveAudioIO> | null = null
    await act(async () => {
      create(<TestHarness onMount={(h) => { hookRef = h }} />)
    })

    await act(async () => {
      await hookRef!.playChunk('abc123')
    })

    act(() => {
      hookRef!.clearPlaybackQueue()
    })

    expect(mockPlayerRelease).toHaveBeenCalled()
    expect(hookRef!.playbackState).toBe('idle')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest __tests__/useLiveAudioIO.test.tsx --no-coverage
```

Expected: `Cannot find module '~/hooks/useLiveAudioIO'`

- [ ] **Step 3: Implement useLiveAudioIO.ts**

Create `src/hooks/useLiveAudioIO.ts`:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react'
import { requestRecordingPermissionsAsync, setAudioModeAsync, createAudioPlayer } from 'expo-audio'
import LiveAudioStream from 'react-native-live-audio-stream'

export type RecordingState = 'idle' | 'recording' | 'error'
export type PlaybackState = 'idle' | 'playing' | 'buffering'

export interface UseLiveAudioIOReturn {
  recordingState: RecordingState
  playbackState: PlaybackState
  error: string | null
  startRecording: () => Promise<void>
  stopRecording: () => void
  playChunk: (base64PCM: string) => Promise<void>
  clearPlaybackQueue: () => void
  onAudioChunk: (cb: (chunk: string) => void) => () => void
}

const PCM_SAMPLE_RATE = 16000
const PCM_CHANNELS = 1
const PCM_BITS_PER_SAMPLE = 16

export function useLiveAudioIO(): UseLiveAudioIOReturn {
  const [recordingState, setRecordingState] = useState<RecordingState>('idle')
  const [playbackState, setPlaybackState] = useState<PlaybackState>('idle')
  const [error, setError] = useState<string | null>(null)

  const chunkListenersRef = useRef<Set<(chunk: string) => void>>(new Set())
  const playerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null)
  const playbackQueueRef = useRef<string[]>([])
  const isPlayingRef = useRef(false)

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: true,
      shouldPlayInBackground: true,
      interruptionMode: 'mixWithOthers',
    }).catch((err: unknown) => {
      console.warn('[useLiveAudioIO] setAudioModeAsync failed', err)
    })

    LiveAudioStream.on('data', (data: string) => {
      chunkListenersRef.current.forEach((cb) => cb(data))
    })

    return () => {
      LiveAudioStream.stop()
      releasePlayer()
    }
  }, [])

  const releasePlayer = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.release()
      playerRef.current = null
    }
    isPlayingRef.current = false
    playbackQueueRef.current = []
    setPlaybackState('idle')
  }, [])

  const startRecording = useCallback(async () => {
    const permission = await requestRecordingPermissionsAsync()
    if (!permission.granted) {
      setError('Microphone permission required. Enable in Settings.')
      setRecordingState('error')
      return
    }

    try {
      LiveAudioStream.init({
        sampleRate: PCM_SAMPLE_RATE,
        channels: PCM_CHANNELS,
        bitsPerSample: PCM_BITS_PER_SAMPLE,
        audioSource: 6, // MIC on Android
        bufferSize: 4096,
      })
      LiveAudioStream.start()
      setError(null)
      setRecordingState('recording')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start recording')
      setRecordingState('error')
    }
  }, [])

  const stopRecording = useCallback(() => {
    LiveAudioStream.stop()
    setRecordingState('idle')
  }, [])

  const drainQueue = useCallback(() => {
    if (playbackQueueRef.current.length === 0) {
      isPlayingRef.current = false
      setPlaybackState('idle')
      return
    }

    const next = playbackQueueRef.current.shift()!
    const dataUri = `data:audio/pcm;rate=24000;encoding=signed-integer;bits=16;base64,${next}`
    const player = createAudioPlayer({ uri: dataUri })
    playerRef.current = player
    isPlayingRef.current = true
    setPlaybackState('playing')

    player.addListener('playbackStatusUpdate', (status) => {
      if (status?.didJustFinish) {
        player.release()
        if (playerRef.current === player) {
          playerRef.current = null
        }
        drainQueue()
      }
    })

    player.play()
  }, [])

  const playChunk = useCallback(
    async (base64PCM: string) => {
      playbackQueueRef.current.push(base64PCM)
      if (!isPlayingRef.current) {
        drainQueue()
      }
    },
    [drainQueue],
  )

  const clearPlaybackQueue = useCallback(() => {
    playbackQueueRef.current = []
    releasePlayer()
  }, [releasePlayer])

  const onAudioChunk = useCallback((cb: (chunk: string) => void) => {
    chunkListenersRef.current.add(cb)
    return () => {
      chunkListenersRef.current.delete(cb)
    }
  }, [])

  return {
    recordingState,
    playbackState,
    error,
    startRecording,
    stopRecording,
    playChunk,
    clearPlaybackQueue,
    onAudioChunk,
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest __tests__/useLiveAudioIO.test.tsx --no-coverage
```

Expected:
```
PASS __tests__/useLiveAudioIO.test.tsx
  useLiveAudioIO
    ✓ startRecording requests permissions and starts recorder
    ✓ startRecording with denied permission sets error state
    ✓ onAudioChunk fires when recorder emits data
    ✓ clearPlaybackQueue stops player immediately
```

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useLiveAudioIO.ts __tests__/useLiveAudioIO.test.tsx
git commit -m "feat: add useLiveAudioIO hook for 16kHz recording and 24kHz PCM playback"
```

---

## Task 6: Build useLiveVoiceChat — pre-flight checks

**Files:**
- Create: `src/hooks/useLiveVoiceChat.ts`
- Create: `__tests__/useLiveVoiceChat.test.tsx`

- [ ] **Step 1: Write failing tests for pre-flight guards**

Create `__tests__/useLiveVoiceChat.test.tsx`:

```typescript
import React from 'react'
import { act, create } from 'react-test-renderer'
import { Alert, AppState } from 'react-native'

const mockRouterPush = jest.fn()
const mockUseCharacter = jest.fn()
const mockUseSelector = jest.fn()
const mockUseCurrentPlan = jest.fn()
const mockStartRecording = jest.fn()
const mockStopRecording = jest.fn()
const mockPlayChunk = jest.fn()
const mockClearPlaybackQueue = jest.fn()
const mockOnAudioChunk = jest.fn().mockReturnValue(() => {})
const mockSend = jest.fn()
const mockGetSnapshot = jest.fn()
const mockUseMachine = jest.fn()
const mockAddEventListener = jest.fn()

jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockRouterPush(...a) } }))
jest.mock('expo-router/react-navigation', () => ({ useNavigation: () => ({ addListener: jest.fn().mockReturnValue(jest.fn()) }) }))
jest.mock('~/hooks/useCharacters', () => ({ useCharacter: (...a: unknown[]) => mockUseCharacter(...a) }))
jest.mock('~/hooks/useMachines', () => ({ useAuthMachine: () => ({}) }))
jest.mock('~/hooks/useCurrentPlan', () => ({ useCurrentPlan: (...a: unknown[]) => mockUseCurrentPlan(...a) }))
jest.mock('@xstate/react', () => ({
  useSelector: (...a: unknown[]) => mockUseSelector(...a),
  useMachine: (...a: unknown[]) => mockUseMachine(...a),
}))
jest.mock('~/hooks/useLiveAudioIO', () => ({
  useLiveAudioIO: () => ({
    recordingState: 'idle',
    playbackState: 'idle',
    error: null,
    startRecording: mockStartRecording,
    stopRecording: mockStopRecording,
    playChunk: mockPlayChunk,
    clearPlaybackQueue: mockClearPlaybackQueue,
    onAudioChunk: mockOnAudioChunk,
  }),
}))
jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() },
  AppState: { addEventListener: (...a: unknown[]) => mockAddEventListener(...a) },
  Platform: { OS: 'ios' },
}))

import { useLiveVoiceChat } from '~/hooks/useLiveVoiceChat'

function makeIdleSnapshot() {
  return {
    matches: (pattern: unknown) => {
      if (typeof pattern === 'string') return pattern === 'idle'
      return false
    },
    context: { transcript: [], activeTool: null, remainingCredits: 10, socketError: null },
  }
}

function TestHarness({ onMount }: { onMount: (h: ReturnType<typeof useLiveVoiceChat>) => void }) {
  const hook = useLiveVoiceChat('char1')
  React.useEffect(() => { onMount(hook) }, [])
  return null
}

describe('useLiveVoiceChat', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    const snapshot = makeIdleSnapshot()
    mockUseMachine.mockReturnValue([snapshot, mockSend, { subscribe: jest.fn(), getSnapshot: () => snapshot }])
    mockUseSelector.mockReturnValue('user1')
    mockAddEventListener.mockReturnValue({ remove: jest.fn() })
  })

  test('startCall shows alert if character has no voice', async () => {
    mockUseCharacter.mockReturnValue({ data: { id: 'char1', voice: null, save_to_cloud: 1 } })
    mockUseCurrentPlan.mockReturnValue({ remainingCredits: 10 })

    let hookRef: ReturnType<typeof useLiveVoiceChat> | null = null
    await act(async () => {
      create(<TestHarness onMount={(h) => { hookRef = h }} />)
    })

    await act(async () => {
      await hookRef!.startCall()
    })

    expect(Alert.alert).toHaveBeenCalledWith(
      'No Voice Set',
      expect.any(String),
      expect.any(Array),
    )
    expect(mockSend).not.toHaveBeenCalled()
  })

  test('startCall shows alert if insufficient credits', async () => {
    mockUseCharacter.mockReturnValue({ data: { id: 'char1', voice: 'en-US', save_to_cloud: 1 } })
    mockUseCurrentPlan.mockReturnValue({ remainingCredits: 1 })

    let hookRef: ReturnType<typeof useLiveVoiceChat> | null = null
    await act(async () => {
      create(<TestHarness onMount={(h) => { hookRef = h }} />)
    })

    await act(async () => {
      await hookRef!.startCall()
    })

    expect(Alert.alert).toHaveBeenCalledWith(
      'Insufficient Credits',
      expect.any(String),
      expect.any(Array),
    )
  })

  test('startCall shows alert if save_to_cloud is disabled', async () => {
    mockUseCharacter.mockReturnValue({ data: { id: 'char1', voice: 'en-US', save_to_cloud: 0 } })
    mockUseCurrentPlan.mockReturnValue({ remainingCredits: 10 })

    let hookRef: ReturnType<typeof useLiveVoiceChat> | null = null
    await act(async () => {
      create(<TestHarness onMount={(h) => { hookRef = h }} />)
    })

    await act(async () => {
      await hookRef!.startCall()
    })

    expect(Alert.alert).toHaveBeenCalledWith(
      'Cloud Sync Required',
      expect.any(String),
      expect.any(Array),
    )
  })

  test('startCall sends START_CALL to machine when all checks pass', async () => {
    mockUseCharacter.mockReturnValue({ data: { id: 'char1', voice: 'en-US', save_to_cloud: 1 } })
    mockUseCurrentPlan.mockReturnValue({ remainingCredits: 10 })
    mockStartRecording.mockResolvedValue(undefined)

    let hookRef: ReturnType<typeof useLiveVoiceChat> | null = null
    await act(async () => {
      create(<TestHarness onMount={(h) => { hookRef = h }} />)
    })

    await act(async () => {
      await hookRef!.startCall()
    })

    expect(mockStartRecording).toHaveBeenCalled()
    expect(mockSend).toHaveBeenCalledWith({ type: 'START_CALL' })
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest __tests__/useLiveVoiceChat.test.tsx --no-coverage
```

Expected: `Cannot find module '~/hooks/useLiveVoiceChat'`

- [ ] **Step 3: Implement useLiveVoiceChat.ts**

Create `src/hooks/useLiveVoiceChat.ts`:

```typescript
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Alert, AppState } from 'react-native'
import { useMachine } from '@xstate/react'
import { useSelector } from '@xstate/react'
import { router } from 'expo-router'
import { useNavigation } from 'expo-router/react-navigation'
import type { IMessage } from 'react-native-gifted-chat'
import { useCharacter } from '~/hooks/useCharacters'
import { useAuthMachine } from '~/hooks/useMachines'
import { useCurrentPlan } from '~/hooks/useCurrentPlan'
import { useLiveAudioIO } from '~/hooks/useLiveAudioIO'
import { liveVoiceMachine } from '~/machines/liveVoiceMachine'

export interface UseLiveVoiceChatReturn {
  isConnecting: boolean
  isLive: boolean
  isSyncing: boolean
  error: string | null
  transcript: IMessage[]
  activeTool: string | null
  remainingCredits: number
  isPlayingAudio: boolean
  startCall: () => Promise<void>
  endCall: () => void
  cancelCall: () => void
}

const MIN_CREDITS_FOR_CALL = 2

export function useLiveVoiceChat(characterId: string): UseLiveVoiceChatReturn {
  const authService = useAuthMachine()
  const currentUser = useSelector(authService, (s) => s.context.user)
  const { data: character } = useCharacter(characterId)
  const { remainingCredits } = useCurrentPlan()
  const navigation = useNavigation()

  const audioIO = useLiveAudioIO()

  const [state, send] = useMachine(liveVoiceMachine, {
    input: {
      characterId,
      userId: currentUser?.uid ?? '',
      initialCredits: typeof remainingCredits === 'number' ? remainingCredits : 0,
    },
    actions: {
      playIncomingAudio: ({ event }) => {
        if (event.type === 'AUDIO_OUTPUT') {
          void audioIO.playChunk(event.data)
        }
      },
      flushAudioPlayback: () => {
        audioIO.clearPlaybackQueue()
      },
    },
  })

  // Mic → machine: forward audio chunks as AUDIO_INPUT events
  useEffect(() => {
    const unsubscribe = audioIO.onAudioChunk((chunk) => {
      send({ type: 'AUDIO_INPUT', data: chunk })
    })
    return unsubscribe
  }, [audioIO, send])

  const endCall = useCallback(() => {
    audioIO.stopRecording()
    send({ type: 'END_CALL' })
  }, [audioIO, send])

  const cancelCall = useCallback(() => {
    audioIO.stopRecording()
    audioIO.clearPlaybackQueue()
    send({ type: 'END_CALL' })
  }, [audioIO, send])

  const startCall = useCallback(async () => {
    if (!character) return

    if (!character.voice) {
      Alert.alert(
        'No Voice Set',
        'This character has no voice selected. Go to character settings to choose one.',
        [
          { text: 'Cancel' },
          { text: 'Edit Character', onPress: () => router.push(`/characters/${characterId}/edit`) },
        ],
      )
      return
    }

    if (typeof remainingCredits === 'number' && remainingCredits < MIN_CREDITS_FOR_CALL) {
      Alert.alert(
        'Insufficient Credits',
        'Live voice calls require credits. Purchase more to continue.',
        [{ text: 'Cancel' }, { text: 'Get More', onPress: () => router.push('/subscribe') }],
      )
      return
    }

    if (!character.save_to_cloud) {
      Alert.alert(
        'Cloud Sync Required',
        'Live voice chat needs cloud sync enabled so your AI can access your memory. Enable it in character settings.',
        [
          { text: 'Cancel' },
          { text: 'Enable Sync', onPress: () => router.push(`/characters/${characterId}/settings`) },
        ],
      )
      return
    }

    await audioIO.startRecording()
    if (audioIO.recordingState === 'error') return  // permission denied

    send({ type: 'START_CALL' })
  }, [audioIO, character, characterId, remainingCredits, send])

  // Navigation blur → end call
  const endCallRef = useRef(endCall)
  useEffect(() => { endCallRef.current = endCall }, [endCall])

  useEffect(() => {
    const unsubscribeBlur = navigation.addListener?.('blur', () => {
      endCallRef.current()
    })
    return () => {
      endCallRef.current()
      unsubscribeBlur?.()
    }
  }, [navigation])

  // AppState backgrounding → end call
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState.match(/inactive|background/) && state.matches({ session: 'live' })) {
        endCallRef.current()
      }
    })
    return () => subscription.remove()
  }, [state])

  const isConnecting = state.matches({ session: 'connecting' })
  const isLive = state.matches({ session: 'live' })
  const isSyncing = state.matches('syncing_memory')
  const errorState = state.matches('error')
  const error = errorState
    ? state.context.socketError === 'credit_exhausted'
      ? 'Out of credits. Tap to get more.'
      : (state.context.socketError ?? 'Connection error')
    : audioIO.error

  return useMemo(
    () => ({
      isConnecting,
      isLive,
      isSyncing,
      error,
      transcript: state.context.transcript,
      activeTool: state.context.activeTool,
      remainingCredits: state.context.remainingCredits,
      isPlayingAudio: audioIO.playbackState === 'playing',
      startCall,
      endCall,
      cancelCall,
    }),
    [
      isConnecting, isLive, isSyncing, error, state.context,
      audioIO.playbackState, startCall, endCall, cancelCall,
    ],
  )
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest __tests__/useLiveVoiceChat.test.tsx --no-coverage
```

Expected: All 4 pre-flight tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useLiveVoiceChat.ts __tests__/useLiveVoiceChat.test.tsx
git commit -m "feat: add useLiveVoiceChat controller hook with pre-flight checks"
```

---

## Task 7: useLiveVoiceChat — AppState + wire-up tests

**Files:**
- Modify: `__tests__/useLiveVoiceChat.test.tsx`

- [ ] **Step 1: Add AppState + audio wiring tests**

Append to the `describe` block in `__tests__/useLiveVoiceChat.test.tsx`:

```typescript
  test('AppState background → sends END_CALL to machine when live', async () => {
    mockUseCharacter.mockReturnValue({ data: { id: 'char1', voice: 'en-US', save_to_cloud: 1 } })
    mockUseCurrentPlan.mockReturnValue({ remainingCredits: 10 })

    const liveSnapshot = {
      matches: (pattern: unknown) => {
        if (typeof pattern === 'object' && pattern !== null) {
          const p = pattern as Record<string, string>
          return p['session'] === 'live'
        }
        return false
      },
      context: { transcript: [], activeTool: null, remainingCredits: 10, socketError: null },
    }
    mockUseMachine.mockReturnValue([liveSnapshot, mockSend, { subscribe: jest.fn(), getSnapshot: () => liveSnapshot }])

    let appStateListener: ((state: string) => void) | null = null
    mockAddEventListener.mockImplementation((_event: string, cb: (state: string) => void) => {
      appStateListener = cb
      return { remove: jest.fn() }
    })

    await act(async () => {
      create(<TestHarness onMount={() => {}} />)
    })

    act(() => {
      appStateListener?.('background')
    })

    expect(mockStopRecording).toHaveBeenCalled()
    expect(mockSend).toHaveBeenCalledWith({ type: 'END_CALL' })
  })

  test('derived state: isLive true when machine in session.live', async () => {
    mockUseCharacter.mockReturnValue({ data: { id: 'char1', voice: 'en-US', save_to_cloud: 1 } })
    mockUseCurrentPlan.mockReturnValue({ remainingCredits: 10 })

    const liveSnapshot = {
      matches: (pattern: unknown) => {
        if (typeof pattern === 'object' && pattern !== null) {
          const p = pattern as Record<string, string>
          return p['session'] === 'live'
        }
        return false
      },
      context: {
        transcript: [{ _id: '1', text: 'Hi', createdAt: new Date(), user: { _id: 'char1' } }],
        activeTool: 'wiki_read',
        remainingCredits: 8,
        socketError: null,
      },
    }
    mockUseMachine.mockReturnValue([liveSnapshot, mockSend, { subscribe: jest.fn(), getSnapshot: () => liveSnapshot }])

    let hookRef: ReturnType<typeof useLiveVoiceChat> | null = null
    await act(async () => {
      create(<TestHarness onMount={(h) => { hookRef = h }} />)
    })

    expect(hookRef!.isLive).toBe(true)
    expect(hookRef!.activeTool).toBe('wiki_read')
    expect(hookRef!.remainingCredits).toBe(8)
    expect(hookRef!.transcript).toHaveLength(1)
  })
```

- [ ] **Step 2: Run tests**

```bash
npx jest __tests__/useLiveVoiceChat.test.tsx --no-coverage
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add __tests__/useLiveVoiceChat.test.tsx
git commit -m "test: add useLiveVoiceChat AppState and state derivation tests"
```

---

## Task 8: Update Talk tab to use useLiveVoiceChat

**Files:**
- Modify: `app/(drawer)/(tabs)/talk/index.tsx`

- [ ] **Step 1: Replace hook import and state destructuring**

In `app/(drawer)/(tabs)/talk/index.tsx`, replace line 20:

```typescript
import { useVoiceChat } from '~/hooks/useVoiceChat'
```

with:

```typescript
import { useLiveVoiceChat } from '~/hooks/useLiveVoiceChat'
```

- [ ] **Step 2: Update TalkView to use new hook API**

Replace the `TalkView` function (lines 25–179) with:

```typescript
function TalkView({ characterId }: { characterId: string }) {
  const { data: character } = useCharacter(characterId)
  const {
    isConnecting,
    isLive,
    isSyncing,
    error,
    transcript,
    activeTool,
    isPlayingAudio,
    startCall,
    endCall,
    cancelCall,
  } = useLiveVoiceChat(characterId)
  const navigation = useNavigation()

  const glowScale = useSharedValue(1)
  const glowOpacity = useSharedValue(0)

  useEffect(() => {
    if (isPlayingAudio) {
      glowOpacity.value = withTiming(0.7, { duration: 250 })
      glowScale.value = withRepeat(
        withTiming(1.15, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      )
    } else {
      cancelAnimation(glowScale)
      cancelAnimation(glowOpacity)
      glowOpacity.value = withTiming(0, { duration: 250 })
      glowScale.value = withTiming(1, { duration: 250 })
    }
  }, [isPlayingAudio, glowOpacity, glowScale])

  const glowAnimatedStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
    transform: [{ scale: glowScale.value }],
  }))

  const endCallRef = useRef(endCall)
  useEffect(() => { endCallRef.current = endCall }, [endCall])

  React.useLayoutEffect(() => {
    if (!character) return
    const drawerNav = navigation.getParent()?.getParent()

    const setHeader = () => {
      drawerNav?.setOptions({
        headerTitle: () => (
          <View style={styles.headerTitle}>
            <Pressable
              onPress={!isLive ? () => router.push(`/characters/${characterId}/edit`) : undefined}
              disabled={isLive}
              accessibilityRole="button"
              accessibilityState={{ disabled: isLive }}
              accessibilityLabel={!isLive ? `Edit ${character.name}` : character.name}
            >
              <CharacterAvatar size={40} imageUrl={character.avatar} characterName={character.name} />
            </Pressable>
            <Text variant="titleMedium" numberOfLines={1}>
              {character.name}
            </Text>
          </View>
        ),
      })
    }

    setHeader()
    const unsubscribeFocus = navigation.addListener?.('focus', setHeader)
    const unsubscribeBlur = navigation.addListener?.('blur', () => {
      drawerNav?.setOptions({ headerTitle: 'Chat' })
    })

    return () => {
      unsubscribeFocus?.()
      unsubscribeBlur?.()
      drawerNav?.setOptions({ headerTitle: 'Chat' })
    }
  }, [character, isLive, characterId, navigation])

  const isBusy = isConnecting || isLive || isSyncing
  const showSpinner = isSyncing || isConnecting

  const statusText = (() => {
    if (error) return error
    if (isSyncing) return 'Syncing memory…'
    if (isConnecting) return 'Connecting…'
    if (isLive && isPlayingAudio) return transcript[transcript.length - 1]?.text ?? 'Speaking…'
    if (isLive && activeTool) return `⏳ ${activeTool.replace(/_/g, ' ')}…`
    if (isLive) {
      const lastUserMsg = [...transcript].reverse().find((m) => m.user._id !== characterId)
      return lastUserMsg?.text ?? 'Listening…'
    }
    return 'Tap the mic to talk'
  })()

  if (!character) {
    return (
      <View style={styles.centered}>
        <Text>Character not found.</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <View style={styles.avatarWrap}>
        <Animated.View style={[styles.glow, glowAnimatedStyle]} />
        <CharacterAvatar
          size={AVATAR_SIZE}
          imageUrl={character.avatar}
          characterName={character.name}
        />
      </View>

      <View style={styles.statusWrap} accessibilityLiveRegion="polite">
        {showSpinner ? <ActivityIndicator size="small" style={styles.spinner} /> : null}
        <Text style={[styles.statusText, error ? styles.errorText : null]}>{statusText}</Text>
      </View>

      <View style={styles.buttonWrap}>
        {isLive ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="End Call"
            onPress={endCall}
            style={[styles.micButton, styles.endCallButton]}
          >
            <MaterialCommunityIcons name="phone-hangup" size={36} color="#ffffff" />
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start Voice Call"
            onPress={startCall}
            disabled={isBusy}
            style={[styles.micButton, isBusy ? styles.micButtonDisabled : null]}
          >
            {showSpinner ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <MaterialCommunityIcons name="microphone" size={36} color="#ffffff" />
            )}
          </Pressable>
        )}
      </View>
    </View>
  )
}
```

- [ ] **Step 3: Add endCallButton style**

In the `StyleSheet.create` block at the bottom of `app/(drawer)/(tabs)/talk/index.tsx`, add after `micButtonDisabled`:

```typescript
  endCallButton: {
    backgroundColor: '#b00020',
  },
```

- [ ] **Step 4: Run existing talk tab tests**

```bash
npx jest __tests__/talkScreenStatusLiveRegion.test.tsx --no-coverage
```

Expected: Tests pass. If they import `useVoiceChat` directly, update the mocks to use `useLiveVoiceChat` instead.

- [ ] **Step 5: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: All tests pass. Fix any import issues from renaming the hook.

- [ ] **Step 6: Commit**

```bash
git add app/(drawer)/(tabs)/talk/index.tsx
git commit -m "feat: update Talk tab to use useLiveVoiceChat (Gemini Live API)"
```

---

## Task 9: Remove old voice hooks (cleanup)

**Files:**
- Modify: `src/hooks/useVoiceChat.ts` (keep file, mark deprecated OR delete if no other references)
- Modify: `src/services/voiceChatService.ts` (keep, still used by old text-based voice flow if applicable)

- [ ] **Step 1: Check remaining references to useVoiceChat**

```bash
grep -r "useVoiceChat\|voiceChatService" /Users/equationalapplications/code/src/github.com/equationalapplications/clanker/src --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v "__tests__"
```

Expected: No references to `useVoiceChat` in `app/` or `src/hooks/` (only the file itself). If `voiceChatService` is referenced elsewhere (not just the old `useVoiceChat`), keep it. If only referenced by `useVoiceChat`, it can be removed in a follow-up.

- [ ] **Step 2: Remove useVoiceChat.ts if unreferenced**

Only if Step 1 shows no references outside `useVoiceChat.ts` itself:

```bash
git rm src/hooks/useVoiceChat.ts
```

- [ ] **Step 3: Remove useVoiceChat test if file removed**

```bash
git rm __tests__/useVoiceChat.test.tsx
```

- [ ] **Step 4: Run tests to confirm nothing broken**

```bash
npx jest --no-coverage
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove deprecated useVoiceChat hook (replaced by useLiveVoiceChat)"
```

---

## Acceptance Criteria Checklist

Before declaring complete, verify each item from the spec:

- [ ] Machine transitions have no race conditions (machine tests cover all state paths)
- [ ] Transcript tokens with same role concatenate (test in Task 3)
- [ ] Barge-in: `clearPlaybackQueue` called on `AUDIO_INTERRUPTED` (injected action in controller)
- [ ] Credits tracked: `USAGE_SNAPSHOT` with 0 → `saving_to_db` (test in Task 3)
- [ ] Pre-call sync runs before WebSocket opens (test in Task 2)
- [ ] Local-only characters blocked by pre-flight (test in Task 6)
- [ ] `AppState` background → `END_CALL` (test in Task 7)
- [ ] Navigation blur → `endCall` (wired in Talk tab and controller hook)
- [ ] `saveAIMessage` is fire-and-forget (no `await` in `saveTranscriptActor`)
- [ ] `expo-audio` configured for 16 kHz input, 24 kHz output
- [ ] WebSocket actor closes cleanly on machine exit (`fromCallback` cleanup)
