import { WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import { services } from '../firebaseAdmin.js'
import { eq, and } from 'drizzle-orm'
import { InMemoryRunner, createEvent, createEventActions } from '@google/adk'
import type { Content, GroundingMetadata } from '@google/genai'
import { hasGroundingData } from '../groundingMetadata.js'
import type { DrizzleClient } from '../db/client.js'
import { users, characters } from '../db/schema.js'
import type { CreditSpendAllocation } from '../services/creditService.js'
import {
  refundGeneratedImages,
  type GeneratedImage,
  type VertexImageGenerator,
} from '../tools/generateImage.js'
import { embedText } from '../db/embeddings.js'
import { buildAgent, assembleSystemInstruction, queryWikiContext } from '../services/agentCore.js'
import { bulkInsertUnsynced } from '../services/unsyncedHistory.js'
import { createCreditService } from '../services/creditService.js'
import type { CreditService } from '../services/creditService.js'
import {
  assertAgentTurnCredits,
  AgentInsufficientCreditsError,
  consumeAgentEvents,
} from '../services/agentEventLoop.js'
import { mapAgentExecutionError } from '../utils/agentExecutionError.js'
import { agentRunSchema } from '../../../shared/cloudAgentProtocol.js'
import { buildNewMessage } from '../agentMessage.js'

export interface WsHandlerOptions {
  db: DrizzleClient
  creditService?: CreditService
  verifyToken?: (token: string) => Promise<{ uid: string }>
  /** Test hook: replaces defaultVertexImageGenerator inside buildAgent. */
  imageGenerator?: VertexImageGenerator
  /** Test hook: bypass ADK and stream canned events */
  mockStreamReply?: string
  /** Test hook: grounding payload emitted with mockStreamReply */
  mockGroundingMetadata?: GroundingMetadata
  /** Test hook: emit this payload as an agent_image frame during the mockStreamReply branch. */
  mockGeneratedImage?: { imageBase64: string; mimeType: string }
}

const AUTH_TIMEOUT_MS = 5000

export async function handleWsUpgrade(
  ws: WebSocket,
  _req: IncomingMessage,
  options: WsHandlerOptions,
) {
  const { db } = options
  const cs = options.creditService ?? createCreditService(db)
  const verifyToken =
    options.verifyToken ??
    ((token: string) => services.auth.verifyIdToken(token).then((d) => ({ uid: d.uid })))

  let userId: string | null = null
  let authTimer: ReturnType<typeof setTimeout>
  let isCompleted = false
  let abortController: AbortController | null = null
  let hasRun = false

  /** Send that can't throw — a disconnected/closing socket must never be mistaken for an ADK processing error. */
  const safeSend = (payload: unknown) => {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload))
      }
    } catch (err) {
      console.error('ws.send failed:', err)
    }
  }

  authTimer = setTimeout(() => {
    if (!userId) {
      safeSend({ type: 'error', code: 'UNAUTHORIZED', message: 'Auth timeout' })
      ws.close(4001, 'Auth timeout')
    }
  }, AUTH_TIMEOUT_MS)

  const handleAgentRunMessage = async (data: WebSocket.RawData) => {
    if (!userId) {
      safeSend({ type: 'error', code: 'UNAUTHORIZED', message: 'Not authenticated' })
      return
    }

    if (hasRun) {
      safeSend({
        type: 'error',
        code: 'INVALID_REQUEST',
        message: 'Only one agent_run per connection is allowed',
      })
      ws.close(4400, 'agent_run already started')
      return
    }

    try {
      const parseResult = agentRunSchema.safeParse(JSON.parse(data.toString()))
      if (!parseResult.success) {
        safeSend({ type: 'error', code: 'INVALID_REQUEST', message: 'Invalid payload' })
        ws.close(4400, 'Invalid payload')
        return
      }

      hasRun = true

      const {
        message,
        characterId,
        unsyncedHistory = [],
        history: rawHistory = [],
        timezone = 'UTC',
        attachments = [],
      } = parseResult.data
      const history = rawHistory as Content[]

      try {
        await assertAgentTurnCredits(userId, cs)
      } catch (creditErr) {
        if (creditErr instanceof AgentInsufficientCreditsError) {
          safeSend({ type: 'error', code: 'INSUFFICIENT_CREDITS', message: 'Insufficient credits' })
          ws.close(4402, 'Insufficient credits')
          return
        }
        throw creditErr
      }

      isCompleted = false
      abortController = new AbortController()

      const [character] = await db
        .select()
        .from(characters)
        .where(and(eq(characters.id, characterId), eq(characters.userId, userId)))
      if (!character) {
        safeSend({ type: 'error', code: 'CHARACTER_NOT_FOUND', message: 'Character not found' })
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
        safeSend({ type: 'token', text: options.mockStreamReply })
        if (options.mockGroundingMetadata && hasGroundingData(options.mockGroundingMetadata)) {
          safeSend({
            type: 'grounding_metadata',
            groundingMetadata: options.mockGroundingMetadata,
          })
        }
        if (options.mockGeneratedImage) {
          safeSend({
            type: 'agent_image',
            imageBase64: options.mockGeneratedImage.imageBase64,
            mimeType: options.mockGeneratedImage.mimeType,
          })
        }
        let newBalance: number | null = null
        try {
          newBalance = await cs.getBalance(userId)
        } catch (balErr) {
          console.warn('getBalance failed:', balErr)
        }
        safeSend({
          type: 'usage_snapshot',
          remainingCredits: newBalance ?? 0,
        })
        isCompleted = true
        ws.close(1000, 'Agent execution complete')
        return
      }

      let systemInstruction: string
      try {
        const wikiContext = await queryWikiContext(db, message, userId, characterId, embedText)
        systemInstruction = assembleSystemInstruction(character, wikiContext)
      } catch (preAgentErr) {
        console.error('Failed to prepare context:', preAgentErr)
        safeSend({ type: 'error', code: 'INTERNAL_ERROR', message: 'Failed to prepare context' })
        ws.close(1011, 'Internal error')
        return
      }

      // Hoisted out of the try so the catch path can still see what the run
      // generated — a loop throw after a successful generation must refund the
      // image spend (§7), which needs both arrays even though the try block
      // that filled them has unwound.
      let imageCollector: GeneratedImage[] = []
      let imageSpendAllocations: CreditSpendAllocation[] = []

      try {
        // Pass the handler's injected cs so the tool spends/refunds hit the same
        // credit service the loop bills with.
        const built = buildAgent(
          db,
          userId,
          characterId,
          systemInstruction,
          timezone,
          embedText,
          undefined,
          undefined,
          { creditService: cs, imageGenerator: options.imageGenerator },
        )
        imageCollector = built.imageCollector
        imageSpendAllocations = built.imageSpendAllocations
        const { agent } = built
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
          newMessage: buildNewMessage(message, attachments),
          abortSignal: abortController.signal,
        })

        const result = await consumeAgentEvents(events, userId, cs, {
          shouldAbort: () => abortController!.signal.aborted,
          onToken: (text) => {
            safeSend({ type: 'token', text })
          },
          onToolStart: (name) => {
            safeSend({ type: 'tool_start', name })
          },
          onToolEnd: (name) => {
            safeSend({ type: 'tool_end', name })
          },
        })

        if (imageCollector.length > 0) {
          // Post-loop delivery (§6.3): text streamed first; the image lands with
          // completion, before usage_snapshot/close. One frame max per run.
          const img = imageCollector[0]
          safeSend({ type: 'agent_image', imageBase64: img.imageBase64, mimeType: img.mimeType })
        }

        if (result.groundingMetadata) {
          safeSend({
            type: 'grounding_metadata',
            groundingMetadata: result.groundingMetadata,
          })
        }

        let newBalance: number | null = null
        try {
          newBalance = await cs.getBalance(userId)
        } catch (balErr) {
          console.warn('getBalance failed:', balErr)
        }

        safeSend({
          type: 'usage_snapshot',
          remainingCredits: newBalance ?? 0,
        })

        isCompleted = true
        ws.close(1000, 'Agent execution complete')
      } catch (adkErr) {
        // §7: if generate_image already succeeded this run, its spend sits
        // outside consumeAgentEvents' own refund scope — return it before the
        // error frame so a failed turn never keeps the image's credits.
        await refundGeneratedImages(userId, cs, imageCollector, imageSpendAllocations)
        console.error('ADK execution error:', adkErr)
        const mapped = mapAgentExecutionError(adkErr)
        safeSend({ type: 'error', code: mapped.code, message: mapped.message })
        try {
          ws.close(1011, 'Execution failed')
        } catch {
          /* ignore close errors */
        }
      }
    } catch (err) {
      console.error('agent_run handler error:', err)
      safeSend({ type: 'error', code: 'INTERNAL_ERROR', message: 'Internal server error' })
      try {
        ws.close(1011, 'Internal error')
      } catch {
        /* ignore close errors */
      }
    }
  }

  const handleAuthMessage = async (data: WebSocket.RawData) => {
    clearTimeout(authTimer)

    try {
      const payload = JSON.parse(data.toString()) as { type?: string; token?: string }
      if (payload.type !== 'auth' || !payload.token) {
        safeSend({ type: 'error', code: 'UNAUTHORIZED', message: 'Invalid auth payload' })
        ws.close(4001, 'Invalid auth payload')
        return
      }

      const decoded = await verifyToken(payload.token)
      const uid = decoded.uid

      const [dbUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.firebaseUid, uid))
      if (!dbUser) {
        safeSend({ type: 'error', code: 'UNAUTHORIZED', message: 'User not found' })
        ws.close(4001, 'User not found')
        return
      }

      userId = dbUser.id
    } catch (err) {
      console.error('Auth failed:', err)
      safeSend({ type: 'error', code: 'UNAUTHORIZED', message: 'Token verification failed' })
      ws.close(4001, 'Token verification failed')
    }
  }

  let messageChain = Promise.resolve()
  ws.on('message', (data) => {
    messageChain = messageChain
      .then(async () => {
        if (!userId) {
          await handleAuthMessage(data)
          return
        }
        await handleAgentRunMessage(data)
      })
      .catch((err) => {
        console.error('WebSocket message handling error:', err)
      })
  })

  ws.on('close', () => {
    clearTimeout(authTimer)
    if (abortController && !isCompleted) {
      abortController.abort()
    }
  })

  ws.on('error', (err) => {
    console.error('WebSocket error:', err)
    clearTimeout(authTimer)
  })
}
