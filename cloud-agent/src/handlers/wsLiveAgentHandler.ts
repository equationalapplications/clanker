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
import { assembleSystemInstruction } from '../services/agentCore.js'
import { buildLiveTools, resolveVoice } from '../services/liveToolAdapter.js'
import { createCreditService } from '../services/creditService.js'
import type { CreditService } from '../services/creditService.js'
import { hasGroundingData } from '../groundingMetadata.js'

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

  let billingTimer: ReturnType<typeof setInterval> | null = null
  let billingInFlight = false
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
    if (msg === null || typeof msg !== 'object') {
      console.warn('[gemini live] ignoring non-object message:', msg)
      return
    }
    console.log('[gemini live] message keys:', Object.keys(msg))
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
            inlineFunctionCalls.push({
              id: part.functionCall.id ?? '',
              name: part.functionCall.name,
              args: part.functionCall.args,
            })
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
      console.log('[gemini live] setupComplete received')
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
        result = await executor(call.args ?? {})
      } catch (err) {
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

      billingTimer = setInterval(() => {
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
