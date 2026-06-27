import { createMachine, assign, fromPromise, fromCallback, sendTo } from 'xstate'
import type { IMessage } from 'react-native-gifted-chat'
import type { GroundingMetadata } from '@google/genai'
import { getWiki } from '~/services/wikiService'
import { wikiSync } from '~/services/apiClient'
import type { WikiSyncDump } from '~/services/apiClient'
import { saveAIMessage, sendMessage } from '~/database/messageDatabase'
import { getCurrentUser } from '~/config/firebaseConfig'
import { getCharacter } from '~/database/characterDatabase'
import { parseGroundingMetadata } from '~/services/groundingMetadata'
import type { GroundedIMessage } from '~/services/aiChatService'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function attachGroundingToTranscript(
  transcript: IMessage[],
  characterId: string,
  grounding: GroundingMetadata,
): GroundedIMessage[] {
  const next = [...transcript] as GroundedIMessage[]
  let lastModelIdx = -1
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i]!.user._id === characterId) {
      lastModelIdx = i
      break
    }
  }
  if (lastModelIdx >= 0) {
    next[lastModelIdx] = { ...next[lastModelIdx]!, groundingMetadata: grounding }
  } else {
    next.push({
      _id: `live_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      text: '',
      createdAt: new Date(),
      user: { _id: characterId },
      groundingMetadata: grounding,
    })
  }
  return next
}

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
  cloudCharacterId: string | null
  userId: string
  transcript: IMessage[]
  activeTool: string | null
  groundingMetadata: GroundingMetadata | null
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
  | { type: 'SESSION_READY'; remainingCredits: number }
  | { type: 'AUDIO_OUTPUT'; data: string }
  | { type: 'TRANSCRIPT_TOKEN'; role: 'user' | 'model'; text: string }
  | { type: 'TOOL_START'; name: string }
  | { type: 'TOOL_END'; name: string }
  | { type: 'GROUNDING_METADATA'; groundingMetadata?: unknown }
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
      cloudCharacterId: null,
      userId: input.userId,
      transcript: [],
      activeTool: null,
      groundingMetadata: null,
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
          input: ({ context }) => ({ characterId: context.characterId, userId: context.userId }),
          onDone: [
            {
              guard: ({ event }) => !event.output?.cloudCharacterId,
              target: 'error',
              actions: assign({ socketError: () => 'Character not synced to cloud. Enable sync in character settings.' }),
            },
            {
              target: 'session',
              actions: assign({ cloudCharacterId: ({ event }) => event.output.cloudCharacterId }),
            },
          ],
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
          input: ({ context }) => ({ characterId: context.cloudCharacterId! }),
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
              SOCKET_OPENED: {},
              SESSION_READY: {
                target: 'live',
                actions: assign({ remainingCredits: ({ event }) => event.remainingCredits }),
              },
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
              GROUNDING_METADATA: {
                actions: assign({
                  groundingMetadata: ({ event }) => {
                    if (event.type !== 'GROUNDING_METADATA') return null
                    return parseGroundingMetadata(event.groundingMetadata) ?? null
                  },
                  transcript: ({ context, event }) => {
                    if (event.type !== 'GROUNDING_METADATA') return context.transcript
                    const parsed = parseGroundingMetadata(event.groundingMetadata)
                    if (!parsed) return context.transcript
                    return attachGroundingToTranscript(context.transcript, context.characterId, parsed)
                  },
                }),
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
            actions: assign({
              transcript: () => [],
              activeTool: () => null,
              groundingMetadata: () => null,
              socketError: () => null,
              retryCount: () => 0,
            }),
          },
          onError: {
            target: 'idle',
            actions: assign({
              transcript: () => [],
              activeTool: () => null,
              groundingMetadata: () => null,
              retryCount: () => 0,
            }),
          },
        },
      },

      error: {
        on: {
          END_CALL: { target: 'idle' },
          START_CALL: {
            target: 'syncing_memory',
            actions: assign({ socketError: () => null, retryCount: () => 0, cloudCharacterId: () => null }),
          },
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
        groundingMetadata: ({ context, event }) => {
          if (event.type !== 'TRANSCRIPT_TOKEN') return context.groundingMetadata
          const msgUserId = event.role === 'user' ? context.userId : context.characterId
          const last = context.transcript[context.transcript.length - 1]
          if (!last || last.user._id !== msgUserId) {
            return null
          }
          return context.groundingMetadata
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
        async ({ input }: { input: { characterId: string; userId: string } }): Promise<{ cloudCharacterId: string | null }> => {
          const wiki = getWiki()
          if (!wiki) throw new Error('Wiki not initialized')

          const char = await getCharacter(input.characterId, input.userId)
          const cloudId = char?.cloud_id && UUID_REGEX.test(char.cloud_id) ? char.cloud_id : null
          if (!cloudId) return { cloudCharacterId: null }

          const localDump = await wiki.exportDump([input.characterId])
          const localBundle = localDump.entities[input.characterId] ?? { facts: [], tasks: [], events: [], edges: [] }

          const cloudDump: WikiSyncDump = {
            generatedAt: localDump.generatedAt,
            entities: {
              [cloudId]: {
                facts: (localBundle.facts ?? []).map((f) => ({ ...f, entity_id: cloudId })),
                tasks: (localBundle.tasks ?? []).map((t) => ({ ...t, entity_id: cloudId })),
                events: (localBundle.events ?? []).map((e) => ({ ...e, entity_id: cloudId })),
                edges: (localBundle.edges ?? []).map((e) => ({ ...e, entity_id: cloudId })),
              },
            },
          }

          const result = await wikiSync({ dump: cloudDump })
          const remoteDump = result.data.remoteDump
          if (remoteDump && Object.keys(remoteDump.entities ?? {}).length > 0) {
            const cloudBundle = remoteDump.entities[cloudId] ?? { facts: [], tasks: [], events: [], edges: [] }
            const mappedDump = {
              generatedAt: remoteDump.generatedAt,
              entities: {
                [input.characterId]: {
                  facts: (cloudBundle.facts ?? []).map((f) => ({ ...f, entity_id: input.characterId })),
                  tasks: (cloudBundle.tasks ?? []).map((t) => ({ ...t, entity_id: input.characterId })),
                  events: (cloudBundle.events ?? []).map((e) => ({ ...e, entity_id: input.characterId })),
                  edges: (cloudBundle.edges ?? []).map((e) => ({ ...e, entity_id: input.characterId })),
                },
              },
            }
            await wiki.importDump(mappedDump as Parameters<typeof wiki.importDump>[0], { merge: true })
          }

          return { cloudCharacterId: cloudId }
        },
      ),

      websocketActor: fromCallback<LiveVoiceEvent, { characterId: string }>(
        ({ sendBack, receive, input }) => {
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
                ws!.send(JSON.stringify({ type: 'auth', token, characterId: input.characterId }))
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
              const grounded = msg as GroundedIMessage
              const additionalData: Partial<GroundedIMessage> = {
                user: msg.user,
                createdAt: msg.createdAt,
              }
              if (grounded.groundingMetadata) {
                additionalData.groundingMetadata = grounded.groundingMetadata
              }
              // Fire-and-forget: do not await, component may be unmounted
              void saveAIMessage(
                characterId,
                userId,
                msg.text,
                String(msg._id),
                additionalData,
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
