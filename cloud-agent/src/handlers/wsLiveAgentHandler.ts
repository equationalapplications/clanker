import { WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import admin from 'firebase-admin'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { GoogleGenAI } from '@google/genai'
import type { GroundingMetadata } from '@google/genai'
import type { DrizzleClient } from '../db/client.js'
import { users, characters } from '../db/schema.js'
import { embedText } from '../db/embeddings.js'
import { assembleSystemInstruction, queryWikiContext } from '../services/agentCore.js'
import { buildLiveTools, resolveVoice } from '../services/liveToolAdapter.js'
import { createCreditService } from '../services/creditService.js'
import type { CreditService } from '../services/creditService.js'
import { hasGroundingData } from '../groundingMetadata.js'
import { defaultFcmDispatcher } from '../services/fcmDispatcher.js'
import { defaultFirestoreSession } from '../services/firestoreSession.js'
import { INSTANCE_ID } from '../services/instanceId.js'
import { getExpoPushToken as dbGetExpoPushToken } from './expoPushToken.js'

export interface BillingControllerOpts {
  spend: () => void
  intervalMs: number
  setIntervalFn?: typeof setInterval
  clearIntervalFn?: typeof clearInterval
}

export function makeBillingController(opts: BillingControllerOpts) {
  const setI = opts.setIntervalFn ?? setInterval
  const clearI = opts.clearIntervalFn ?? clearInterval
  let timer: ReturnType<typeof setInterval> | null = null
  let paused = false
  return {
    start() { timer = setI(() => { if (!paused) opts.spend() }, opts.intervalMs) },
    pause() { paused = true },
    resume() { paused = false },
    stop() { if (timer !== null) { clearI(timer); timer = null } },
  }
}
export type BillingController = ReturnType<typeof makeBillingController>

const billingControllers = new Map<string, BillingController>()
export function getBillingController(key: string): BillingController | undefined { return billingControllers.get(key) }

type GeminiSession = {
  sendRealtimeInput(input: { audio: { data: string; mimeType: string } }): void
  sendToolResponse(response: {
    functionResponses: Array<{ id: string; name: string; response: { output: unknown } }>
  }): void
  close(): void
}

type LiveConnectCfg = {
  model: string
  callbacks: { onmessage: (msg: unknown) => void; onclose: () => void; onerror?: (e: unknown) => void }
  config: unknown
}

const liveAuthSchema = z.object({
  type: z.literal('auth'),
  token: z.string().min(1),
  characterId: z.string().uuid(),
  memoryQuery: z.string().trim().max(2000).optional(),
  recentChatContext: z.string().trim().max(2000).optional(),
})

export interface WsLiveHandlerOptions {
  db: DrizzleClient
  creditService?: CreditService
  verifyToken?: (token: string) => Promise<{ uid: string }>
  liveConnect?: (cfg: LiveConnectCfg) => Promise<GeminiSession>
  billingIntervalMs?: number
  _clearInterval?: (id: ReturnType<typeof setInterval> | undefined) => void
  browserBridge?: Omit<import('../tools/browserAction.js').BrowserActionDeps, 'pushToLive' | 'pauseBilling' | 'resumeBilling' | 'registerLiveCall'>
  /** Injectable for testing; defaults to DB lookup. */
  getExpoPushToken?: (firebaseUid: string) => Promise<string | null>
}

const AUTH_TIMEOUT_MS = 5000

const isGeminiLiveDebug =
  process.env.GEMINI_LIVE_DEBUG === 'true' ||
  (!process.env.K_SERVICE && process.env.NODE_ENV !== 'production')

async function defaultLiveConnect(cfg: LiveConnectCfg): Promise<GeminiSession> {
  const project = [
    process.env.GCLOUD_PROJECT,
    process.env.GCP_PROJECT,
    process.env.GOOGLE_CLOUD_PROJECT,
  ].map((v) => v?.trim()).find((v): v is string => Boolean(v))
  if (!project) throw new Error('Missing GCP project env for Gemini Live')
  // Gemini Live is only available in us-central1; ignore GOOGLE_CLOUD_LOCATION (may be 'global')
  const location = 'us-central1'
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

  let billingController: BillingController | null = null
  let billingInFlight = false
  let geminiSession: GeminiSession | null = null
  let isAuthenticated = false
  let userId: string | null = null
  let liveSessionKey: string | null = null
  let toolExecutors = new Map<string, (args: unknown) => Promise<unknown>>()
  let activeBrowserCallId: string | null = null
  const browserCallByTaskId = new Map<string, string>()

  function clearAndClose(): void {
    if (billingController !== null) {
      billingController.stop()
      if (liveSessionKey) billingControllers.delete(liveSessionKey)
      billingController = null
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
    if (msg === null || typeof msg !== 'object') {
      console.warn('[gemini live] ignoring non-object message:', msg)
      return
    }
    if (isGeminiLiveDebug) {
      console.log('[gemini live] message keys:', Object.keys(msg))
    }
    const m = msg as {
      serverContent?: {
        modelTurn?: { parts?: Array<{ inlineData?: { data: string }; functionCall?: { id?: string; name?: string; args?: unknown } }> }
        outputTranscription?: { text?: string }
        inputTranscription?: { text?: string }
        interrupted?: boolean
        groundingMetadata?: unknown
      }
      toolCall?: {
        functionCalls?: Array<{ id: string; name: string; args?: unknown }>
      }
      goAway?: { timeLeft?: string }
      setupComplete?: unknown
    }

    if (m.serverContent) {
      const sc = m.serverContent
      const inlineFunctionCalls: Array<{ id: string; name: string; args?: unknown }> = []
      if (sc.modelTurn?.parts) {
        for (const part of sc.modelTurn.parts) {
          if (part.inlineData?.data) {
            try {
              ws.send(JSON.stringify({ type: 'audio_output', data: part.inlineData.data }))
            } catch { /* ignore */ }
          }
          if (part.functionCall?.name) {
            const callId = part.functionCall.id
            if (!callId) {
              console.warn(
                '[live tools] skipping inline functionCall without id:',
                part.functionCall.name,
              )
            } else {
              inlineFunctionCalls.push({
                id: callId,
                name: part.functionCall.name,
                args: part.functionCall.args,
              })
            }
          }
        }
      }
      if (inlineFunctionCalls.length > 0) {
        void handleToolCalls(inlineFunctionCalls)
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
      if (hasGroundingData(sc.groundingMetadata as GroundingMetadata | undefined)) {
        try {
          ws.send(JSON.stringify({
            type: 'grounding_metadata',
            groundingMetadata: sc.groundingMetadata,
          }))
        } catch { /* ignore */ }
      }
    }

    if (m.toolCall?.functionCalls?.length) {
      void handleToolCalls(m.toolCall.functionCalls)
    }

    if ((m as { error?: unknown }).error) {
      console.error('[gemini live] error field in message:', (m as { error?: unknown }).error)
    }

    if (m.goAway) {
      console.error('[gemini live] goAway received:', m.goAway)
    }

    if (m.setupComplete !== undefined) {
      if (isGeminiLiveDebug) {
        console.log('[gemini live] setupComplete received')
      }
    }
  }

  function handleGeminiClose(e?: { code?: number; reason?: string }): void {
    console.error('[gemini live] connection closed', { code: e?.code, reason: e?.reason })
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
        if (call.name === 'browser_action') activeBrowserCallId = call.id
        result = await executor(call.args ?? {})
      } catch (err) {
        if (call.name === 'browser_action') activeBrowserCallId = null
        result = { error: err instanceof Error ? err.message : 'Tool execution failed' }
      }

      try {
        geminiSession?.sendToolResponse({
          functionResponses: [{ id: call.id, name: call.name, response: { output: result } }],
        })
      } catch (err) {
        console.error('[live tools] sendToolResponse failed:', err)
      }

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

      const { token, characterId, memoryQuery, recentChatContext } = parseResult.data

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

      const spendOnce = () => {
        if (billingInFlight) return
        billingInFlight = true
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
          } finally {
            billingInFlight = false
          }
        })()
      }

      billingController = makeBillingController({
        spend: spendOnce,
        intervalMs: billingIntervalMs,
        clearIntervalFn: clearIntervalFn as never,
      })

      liveSessionKey = `${userId}:${crypto.randomUUID()}`
      billingControllers.set(liveSessionKey, billingController)

      const bridgeBase = options.browserBridge ?? (admin.apps.length ? {
        firebaseUid: uid,
        userId: userId!,
        firestoreSession: defaultFirestoreSession(),
        fcmDispatcher: defaultFcmDispatcher(),
        creditService: cs,
        instanceId: INSTANCE_ID,
      } : undefined)

      const { declarations, executors } = bridgeBase
        ? buildLiveTools(db, userId, characterId, embedText, timezone, {
          ...bridgeBase,
          pauseBilling: () => billingController?.pause(),
          resumeBilling: () => billingController?.resume(),
          registerLiveCall: (taskId: string) => {
            if (activeBrowserCallId) {
              browserCallByTaskId.set(taskId, activeBrowserCallId)
              activeBrowserCallId = null
            }
          },
          pushToLive: (taskId: string, bridgeSessionId: string, text: string) => {
            const callId = browserCallByTaskId.get(taskId)
            if (!callId) return
            browserCallByTaskId.delete(taskId)
            const sessionOpen = geminiSession !== null && ws.readyState === WebSocket.OPEN
            if (sessionOpen) {
              try {
                geminiSession!.sendToolResponse({
                  functionResponses: [{ id: callId, name: 'browser_action', response: { output: text } }],
                })
                return
              } catch (err) {
                console.warn('[pushToLive] live tool response failed, falling back to Expo Push:', err)
              }
            }
            // Voice session closed or live delivery failed — deliver via Expo Push fallback.
            if (bridgeBase?.fcmDispatcher && bridgeBase.firebaseUid) {
              const fwd = bridgeBase.fcmDispatcher
              const fbUid = bridgeBase.firebaseUid
              const getToken = options.getExpoPushToken ?? ((uid: string) => dbGetExpoPushToken(options.db, uid))
              void getToken(fbUid)
                .then(async (token) => {
                  if (token) await fwd.sendTaskComplete(token, bridgeSessionId, taskId, text)
                })
                .catch((err) => console.error('[pushToLive Expo fallback]', err))
            }
          },
        })
        : buildLiveTools(db, userId, characterId, embedText, timezone)
      toolExecutors = executors

      let wikiContext = ''
      const memoryAnchor = memoryQuery?.trim() ?? ''
      if (memoryAnchor) {
        try {
          let timeoutId: ReturnType<typeof setTimeout> | undefined
          wikiContext = await Promise.race([
            queryWikiContext(db, memoryAnchor, userId, characterId, embedText),
            new Promise<string>((_, reject) => {
              timeoutId = setTimeout(
                () => reject(new Error('queryWikiContext timed out after 5000ms')),
                5_000,
              )
            }),
          ]).finally(() => {
            if (timeoutId !== undefined) clearTimeout(timeoutId)
          })
        } catch (err) {
          console.warn('[live] queryWikiContext failed, starting without preloaded memory:', err)
        }
      }

      const systemInstruction = assembleSystemInstruction(
        character,
        wikiContext,
        recentChatContext?.trim() || memoryAnchor,
      )

      try {
        geminiSession = await liveConnect({
          model: 'gemini-live-2.5-flash-native-audio',
          callbacks: {
            onmessage: handleGeminiMessage,
            onclose: handleGeminiClose,
            onerror: (e: unknown) => { console.error('[gemini live] error event:', e) },
          },
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

      billingController.start()

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
              audio: { data: payload.data, mimeType: 'audio/pcm;rate=16000' },
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
