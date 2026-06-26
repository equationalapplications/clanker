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

/** Persistent state managed by liveVoiceMachine across the call lifecycle. */
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

/** Input provided when spawning liveVoiceMachine via useMachine. */
export interface LiveVoiceMachineInput {
  characterId: string
  userId: string
  initialCredits?: number
}

const MAX_RETRIES = 5
const RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000]

/**
 * XState machine orchestrating the live voice call lifecycle:
 * idle → syncing_memory → session (connecting → live) → saving_to_db → idle.
 */
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
        on: {
          END_CALL: { target: 'idle' },
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
              END_CALL: { target: '#liveVoiceMachine.saving_to_db' },
            },
          },
          live: {
            entry: assign({ retryCount: () => 0 }),
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
            actions: assign({ transcript: () => [], activeTool: () => null, socketError: () => null, retryCount: () => 0 }),
          },
          onError: {
            target: 'idle',
            actions: assign({ transcript: () => [], activeTool: () => null, retryCount: () => 0 }),
          },
        },
      },

      error: {
        on: {
          END_CALL: { target: 'idle' },
          RETRY: [
            {
              guard: ({ context }) => context.retryCount < MAX_RETRIES,
              target: 'syncing_memory',
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
              target: 'syncing_memory',
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
          if (!wiki) throw new Error('Wiki not initialized')
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
            if (ws?.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'end_session' }))
            }
            ws?.close()
            ws = null
          }

          const user = getCurrentUser()
          if (!user) {
            sendBack({ type: 'SOCKET_ERROR', message: 'No authenticated user' })
            return
          }
          user
            .getIdToken()
            .then((token) => {
              if (cleanedUp) return
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
              ).catch((err: unknown) => {
                console.error('[saveTranscriptActor] saveAIMessage failed', err)
              })
            } else {
              void sendMessage(characterId, userId, msg.text, String(msg._id)).catch((err: unknown) => {
                console.error('[saveTranscriptActor] sendMessage failed', err)
              })
            }
          }
        },
      ),
    },
  },
)
