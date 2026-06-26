import { WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import admin from 'firebase-admin'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { InMemoryRunner, isFinalResponse, createEvent, createEventActions } from '@google/adk'
import type { Content } from '@google/genai'
import type { DrizzleClient } from '../db/client.js'
import { users, characters } from '../db/schema.js'
import { embedText } from '../db/embeddings.js'
import { buildAgent, assembleSystemInstruction, queryWikiContext } from '../services/agentCore.js'
import { bulkInsertUnsynced } from '../services/unsyncedHistory.js'
import { createCreditService } from '../services/creditService.js'
import type { CreditService } from '../services/creditService.js'

const contentSchema = z.object({
  role: z.enum(['user', 'model']),
  parts: z.array(z.object({}).passthrough()).min(1),
})

const agentRunSchema = z.object({
  type: z.literal('agent_run').optional(),
  message: z.string().trim().min(1),
  characterId: z.string().uuid(),
  unsyncedHistory: z.array(z.unknown()).optional(),
  history: z.array(contentSchema).optional(),
  timezone: z.string().optional(),
})

export interface WsHandlerOptions {
  db: DrizzleClient
  creditService?: CreditService
  verifyToken?: (token: string) => Promise<{ uid: string }>
  /** Test hook: bypass ADK and stream canned events */
  mockStreamReply?: string
}

const AUTH_TIMEOUT_MS = 5000

export async function handleWsUpgrade(
  ws: WebSocket,
  _req: IncomingMessage,
  options: WsHandlerOptions,
) {
  const { db } = options
  const cs = options.creditService ?? createCreditService(db)
  const verifyToken = options.verifyToken ?? ((token: string) =>
    admin.auth().verifyIdToken(token).then((d) => ({ uid: d.uid })))

  let userId: string | null = null
  let authTimer: ReturnType<typeof setTimeout>
  let isCompleted = false
  let abortController: AbortController | null = null
  let activeTxId: string | null = null

  authTimer = setTimeout(() => {
    if (!userId) {
      ws.close(4001, 'Auth timeout')
    }
  }, AUTH_TIMEOUT_MS)

  const refundIfNeeded = async () => {
    if (userId && activeTxId && !isCompleted) {
      try {
        await cs.refundCredit(userId, activeTxId)
      } catch (refundErr) {
        console.error(`[CRITICAL] WS refundCredit failed user=${userId} txId=${activeTxId}`, refundErr)
      }
      activeTxId = null
    }
  }

  const handleAgentRunMessage = async (data: WebSocket.RawData) => {
    if (!userId) {
      ws.send(JSON.stringify({ type: 'error', code: 'UNAUTHORIZED', message: 'Not authenticated' }))
      return
    }

    if (hasRun) {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'INVALID_REQUEST',
        message: 'Only one agent_run per connection is allowed',
      }))
      ws.close(4400, 'agent_run already started')
      return
    }

    try {
      const parseResult = agentRunSchema.safeParse(JSON.parse(data.toString()))
      if (!parseResult.success) {
        ws.send(JSON.stringify({ type: 'error', code: 'INVALID_REQUEST', message: 'Invalid payload' }))
        ws.close(4400, 'Invalid payload')
        return
      }

      hasRun = true

      const { message, characterId, unsyncedHistory = [], history: rawHistory = [], timezone = 'UTC' } = parseResult.data
      const history = rawHistory as Content[]

      let txId: string
      try {
        txId = await cs.spendCredit(userId)
      } catch (creditErr: unknown) {
        const msg = creditErr instanceof Error ? creditErr.message : ''
        if (msg === 'INSUFFICIENT_CREDITS') {
          ws.send(JSON.stringify({ type: 'error', code: 'INSUFFICIENT_CREDITS', message: 'Insufficient credits' }))
          ws.close(4402, 'Insufficient credits')
          return
        }
        throw creditErr
      }

      activeTxId = txId
      isCompleted = false
      abortController = new AbortController()

      const [character] = await db.select().from(characters).where(
        and(eq(characters.id, characterId), eq(characters.userId, userId)),
      )
      if (!character) {
        await cs.refundCredit(userId, txId)
        activeTxId = null
        ws.send(JSON.stringify({ type: 'error', code: 'CHARACTER_NOT_FOUND', message: 'Character not found' }))
        ws.close(4404, 'Character not found')
        return
      }

      if (unsyncedHistory.length > 0) {
        try {
          await bulkInsertUnsynced(db, userId, characterId, unsyncedHistory, embedText)
        } catch (err) {
          console.error('bulkInsertUnsynced failed:', err)
        }
      }

      if (options.mockStreamReply !== undefined) {
        ws.send(JSON.stringify({ type: 'token', text: options.mockStreamReply }))
        let newBalance: number | null = null
        try {
          newBalance = await cs.getBalance(userId)
        } catch (balErr) {
          console.warn('getBalance failed:', balErr)
        }
        ws.send(JSON.stringify({
          type: 'usage_snapshot',
          remainingCredits: newBalance ?? 0,
        }))
        isCompleted = true
        activeTxId = null
        ws.close(1000, 'Agent execution complete')
        return
      }

      let systemInstruction: string
      try {
        const wikiContext = await queryWikiContext(db, message, userId, characterId, embedText)
        systemInstruction = assembleSystemInstruction(character, wikiContext)
      } catch (preAgentErr) {
        await cs.refundCredit(userId, txId)
        activeTxId = null
        console.error('Failed to prepare context:', preAgentErr)
        ws.send(JSON.stringify({ type: 'error', code: 'INTERNAL_ERROR', message: 'Failed to prepare context' }))
        ws.close(1011, 'Internal error')
        return
      }

      try {
        const agent = buildAgent(db, userId, characterId, systemInstruction, timezone, embedText)
        const runner = new InMemoryRunner({ agent, appName: 'clanker-cloud-agent' })
        const sessionId = crypto.randomUUID()

        const session = await runner.sessionService.createSession({
          appName: 'clanker-cloud-agent',
          userId,
          sessionId,
        })

        if (history.length > 0) {
          for (const turn of history) {
            await runner.sessionService.appendEvent({
              session,
              event: createEvent({
                invocationId: crypto.randomUUID(),
                author: turn.role === 'user' ? 'user' : agent.name,
                content: turn,
                actions: createEventActions(),
              }),
            })
          }
        }

        const events = runner.runAsync({
          userId,
          sessionId,
          newMessage: { role: 'user', parts: [{ text: message }] },
        })

        let lastToolName: string | null = null

        for await (const event of events) {
          if (abortController.signal.aborted) {
            throw new Error('Client disconnected')
          }
          if (event.errorCode || event.errorMessage) {
            throw new Error(`ADK error (${event.errorCode}): ${event.errorMessage}`)
          }

          if (event.content?.parts) {
            for (const part of event.content.parts) {
              if ('functionCall' in part) {
                const fc = (part as { functionCall?: { name?: string } }).functionCall
                if (fc?.name && lastToolName !== fc.name) {
                  ws.send(JSON.stringify({ type: 'tool_start', name: fc.name }))
                  lastToolName = fc.name
                }
              }
            }
          }

          if (lastToolName && event.content && !event.content.parts?.some(p => 'functionCall' in p)) {
            ws.send(JSON.stringify({ type: 'tool_end', name: lastToolName }))
            lastToolName = null
          }

          if (event.content?.parts) {
            for (const part of event.content.parts) {
              if ('text' in part) {
                const text = (part as { text: string }).text
                if (text) {
                  ws.send(JSON.stringify({ type: 'token', text }))
                }
              }
            }
          }

          if (isFinalResponse(event)) {
            break
          }
        }

        let newBalance: number | null = null
        try {
          newBalance = await cs.getBalance(userId)
        } catch (balErr) {
          console.warn('getBalance failed:', balErr)
        }

        ws.send(JSON.stringify({
          type: 'usage_snapshot',
          remainingCredits: newBalance ?? 0,
        }))

        isCompleted = true
        activeTxId = null
        ws.close(1000, 'Agent execution complete')
      } catch (adkErr) {
        console.error('ADK execution error:', adkErr)
        if (!isCompleted) {
          await refundIfNeeded()
        }
        ws.send(JSON.stringify({ type: 'error', code: 'INTERNAL_ERROR', message: 'Agent execution failed' }))
        ws.close(1011, 'Execution failed')
      }
    } catch (err) {
      console.error('agent_run handler error:', err)
      await refundIfNeeded()
      ws.send(JSON.stringify({ type: 'error', code: 'INTERNAL_ERROR', message: 'Internal server error' }))
      ws.close(1011, 'Internal error')
    }
  }

  const handleAuthMessage = async (data: WebSocket.RawData) => {
    clearTimeout(authTimer)

    try {
      const payload = JSON.parse(data.toString()) as { type?: string; token?: string }
      if (payload.type !== 'auth' || !payload.token) {
        ws.close(4001, 'Invalid auth payload')
        return
      }

      const decoded = await verifyToken(payload.token)
      const uid = decoded.uid

      const [dbUser] = await db.select({ id: users.id }).from(users).where(eq(users.firebaseUid, uid))
      if (!dbUser) {
        ws.send(JSON.stringify({ type: 'error', code: 'UNAUTHORIZED', message: 'User not found' }))
        ws.close(4001, 'User not found')
        return
      }

      userId = dbUser.id
    } catch (err) {
      console.error('Auth failed:', err)
      ws.send(JSON.stringify({ type: 'error', code: 'UNAUTHORIZED', message: 'Token verification failed' }))
      ws.close(4001, 'Token verification failed')
    }
  }

  let messageChain = Promise.resolve()
  ws.on('message', (data) => {
    messageChain = messageChain.then(async () => {
      if (!userId) {
        await handleAuthMessage(data)
        return
      }
      await handleAgentRunMessage(data)
    }).catch((err) => {
      console.error('WebSocket message handling error:', err)
    })
  })

  ws.on('close', () => {
    clearTimeout(authTimer)
    if (abortController && !isCompleted) {
      abortController.abort()
      void refundIfNeeded()
    }
  })

  ws.on('error', (err) => {
    console.error('WebSocket error:', err)
    clearTimeout(authTimer)
  })
}
