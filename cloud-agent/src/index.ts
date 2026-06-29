import express, { Request, Response, NextFunction } from 'express'
import type { Server } from 'http'
import cors from 'cors'
import { rateLimit } from 'express-rate-limit'
import admin from 'firebase-admin'
import { eq, and } from 'drizzle-orm'
import { InMemoryRunner, isFinalResponse, createEvent, createEventActions } from '@google/adk'
import type { Content, GroundingMetadata } from '@google/genai'
import { WebSocketServer } from 'ws'
import { getDb } from './db/client.js'
import { buildAgent } from './agent.js'
import { hasGroundingData } from './groundingMetadata.js'
import { assembleSystemInstruction, queryWikiContext } from './services/agentCore.js'
import { bulkInsertUnsynced } from './services/unsyncedHistory.js'
import { users, characters } from './db/schema.js'
import { embedText } from './db/embeddings.js'
import type { DrizzleClient } from './db/client.js'
import { createCreditService } from './services/creditService.js'
import type { CreditService } from './services/creditService.js'
import { handleWsUpgrade, type WsHandlerOptions } from './handlers/wsAgentHandler.js'
import { handleLiveWsUpgrade, type WsLiveHandlerOptions } from './handlers/wsLiveAgentHandler.js'
import { handleBrowserWsUpgrade } from './handlers/wsBrowserAgentHandler.js'
import { defaultFirestoreSession } from './services/firestoreSession.js'
import { defaultFcmDispatcher } from './services/fcmDispatcher.js'
import { upsertDeviceRecord } from './services/deviceUpsert.js'
import { upsertExpoPushToken, getExpoPushToken } from './handlers/expoPushToken.js'
import { handleApproveAction } from './handlers/approveAction.js'
import { createSchedulerTriggerHandler, isSchedulerAuthorized } from './handlers/schedulerTriggerHandler.js'
import { INSTANCE_ID } from './services/instanceId.js'
import { z } from 'zod'

export { INSTANCE_ID } from './services/instanceId.js'

const contentSchema = z.object({
  role: z.enum(['user', 'model']),
  parts: z.array(z.object({}).passthrough()).min(1),
})

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RunAgentParams {
  db: DrizzleClient
  userId: string
  firebaseUid: string
  characterId: string
  systemInstruction: string
  message: string
  history: Content[]
  timezone: string
  embed: (text: string) => Promise<number[]>
}

export interface AppOptions {
  verifyToken: (token: string) => Promise<{ uid: string }>
  db: DrizzleClient
  runAgentFn: (params: RunAgentParams) => Promise<{ reply: string; toolCalls: string[]; groundingMetadata?: GroundingMetadata }>
  creditService?: CreditService
  wsHandlerOptions?: Partial<WsHandlerOptions>
  wsLiveHandlerOptions?: Partial<WsLiveHandlerOptions>
  upsertDevice?: (uid: string, body: { fcmToken: string; deviceId: string; deviceName: string; isPaused?: boolean }) => Promise<void>
}

// ── Real agent runner (production) ────────────────────────────────────────────

export async function runAgentReal(params: RunAgentParams): Promise<{ reply: string; toolCalls: string[]; groundingMetadata?: GroundingMetadata }> {
  const { db, userId, firebaseUid, characterId, systemInstruction, message, history, timezone, embed } = params
  const bridge = admin.apps.length ? {
    firebaseUid,
    userId,
    firestoreSession: defaultFirestoreSession(),
    fcmDispatcher: defaultFcmDispatcher(),
    creditService: createCreditService(db),
    instanceId: INSTANCE_ID,
  } : undefined
  const agent = buildAgent(db, userId, characterId, systemInstruction, timezone, embed, bridge)
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

  let reply = ''
  const toolCalls: string[] = []
  // Google Search grounding ToS requires surfacing the citation/search-suggestions
  // Gemini returns. ADK exposes it as event.groundingMetadata (Event extends
  // LlmResponse). Keep the last non-empty one — it rides the final response event.
  let groundingMetadata: GroundingMetadata | undefined
  for await (const event of events) {
    if (event.errorCode || event.errorMessage) {
      throw new Error(`ADK error (${event.errorCode ?? 'unknown'}): ${event.errorMessage ?? 'no message'}`)
    }
    if (event.content?.parts) {
      for (const part of event.content.parts) {
        if ('functionCall' in part) {
          const fc = (part as { functionCall?: { name?: string } }).functionCall
          if (fc?.name) toolCalls.push(fc.name)
        }
      }
    }
    if (hasGroundingData(event.groundingMetadata)) {
      groundingMetadata = event.groundingMetadata
    }
    if (isFinalResponse(event) && event.content?.parts) {
      reply = event.content.parts
        .filter((p) => 'text' in p)
        .map((p) => (p as { text: string }).text)
        .join('')
    }
  }

  if (!reply.trim()) {
    throw new Error('ADK returned an empty final reply')
  }
  return { reply, toolCalls, groundingMetadata }
}

// ── App factory ───────────────────────────────────────────────────────────────

function corsOrigins(): string | string[] | boolean {
  const raw = process.env.CORS_ORIGIN
  // No env var → reflect the request Origin (allow all). Safe because auth uses
  // Authorization header (not cookies), so credentials are not at risk.
  if (!raw) return true

  const origins = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((value) => {
      try {
        return new URL(value).origin
      } catch {
        return value.replace(/\/$/, '')
      }
    })

  const filtered = origins.filter((o) => o !== '*')
  return filtered.length > 0 ? filtered : false
}

export function createApp(options: AppOptions) {
  const { verifyToken, db, runAgentFn } = options
  const cs = options.creditService ?? createCreditService(options.db)
  const app = express()
  // trust proxy is required behind Cloud Run's managed load balancer so that
  // rate-limiting sees the real client IP via X-Forwarded-For. Cloud Run always
  // sets K_SERVICE; fall back to an explicit TRUST_PROXY flag for other envs.
  if (process.env.K_SERVICE || process.env.TRUST_PROXY === '1') {
    app.set('trust proxy', 1)
  }
  app.use(cors({ origin: corsOrigins() }))
  app.use(express.json({ limit: '2mb' }))

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' })
  })

  const requireAuth = async (
    req: Request & { uid?: string },
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const authHeader = req.headers.authorization ?? ''
    const token = authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim() || undefined
      : undefined
    if (!token) { res.status(401).json({ error: 'Unauthorized' }); return }
    try {
      const decoded = await verifyToken(token)
      req.uid = decoded.uid
      next()
    } catch {
      res.status(401).json({ error: 'Unauthorized' })
    }
  }

  const rateLimitHandler = (_req: Request, res: Response) => {
    res.status(429).json({ error: 'Too many requests. Please try again later.' })
  }

  const agentRunLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: rateLimitHandler,
  })

  const authRouteLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: rateLimitHandler,
  })

  const schedulerTriggerLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: rateLimitHandler,
  })

  app.post('/agent/run', agentRunLimiter, requireAuth, async (req: Request & { uid?: string }, res: Response): Promise<void> => {
    try {
      const parseResult = z
        .object({
          message: z.string().trim().min(1),
          characterId: z.string().uuid(),
          unsyncedHistory: z.array(z.unknown()).optional(),
          history: z.array(contentSchema).optional(),
        })
        .safeParse(req.body)
      if (!parseResult.success) {
        res.status(400).json({ error: 'Invalid request body' })
        return
      }
      const { message, characterId, unsyncedHistory = [], history: rawHistory = [] } = parseResult.data
      const history = rawHistory as Content[]
      const firebaseUid = req.uid!
      const timezone = typeof req.headers['x-timezone'] === 'string' ? req.headers['x-timezone'].trim() : 'UTC'

      // Map Firebase UID → DB user UUID (users.id is UUID; firebase_uid is the token uid)
      const [dbUser] = await db.select({ id: users.id }).from(users).where(eq(users.firebaseUid, firebaseUid))
      if (!dbUser) { res.status(401).json({ error: 'Unauthorized' }); return }
      const userId = dbUser.id

      // Verify character exists and belongs to this user before any writes
      const [character] = await db.select().from(characters).where(
        and(eq(characters.id, characterId), eq(characters.userId, userId))
      )
      if (!character) { res.status(404).json({ error: 'Character not found' }); return }

      // SPEND FIRST — fail fast with 402 before any non-essential work or writes
      let txId: string
      try {
        txId = await cs.spendCredit(userId)
      } catch (creditErr: unknown) {
        const msg = creditErr instanceof Error ? creditErr.message : ''
        if (msg === 'INSUFFICIENT_CREDITS') {
          res.status(402).json({ error: 'Insufficient credits' })
          return
        }
        throw creditErr
      }

      if (unsyncedHistory.length > 0) {
        try {
          await bulkInsertUnsynced(db, userId, characterId, unsyncedHistory, embedText)
        } catch (err) {
          // Swallow sync errors so the agent can still respond (matches Firebase generateReply behavior)
          console.error('bulkInsertUnsynced failed:', err)
        }
      }

      let wikiContext: string
      let systemInstruction: string
      try {
        wikiContext = await queryWikiContext(db, message, userId, characterId, embedText)
        systemInstruction = assembleSystemInstruction(character, wikiContext)
      } catch (preAgentErr) {
        try {
          await cs.refundCredit(userId, txId)
        } catch (refundErr) {
          console.error(`[CRITICAL] refundCredit failed user=${userId} txId=${txId}`, refundErr)
        }
        throw preAgentErr
      }
      // 2. EXECUTE — refund on ADK failure
      let result: { reply: string; toolCalls: string[]; groundingMetadata?: GroundingMetadata }
      try {
        result = await runAgentFn({ db, userId, firebaseUid, characterId, systemInstruction, message, history, timezone, embed: embedText })
      } catch (adkErr) {
        try {
          await cs.refundCredit(userId, txId)
        } catch (refundErr) {
          console.error(`[CRITICAL] refundCredit failed user=${userId} txId=${txId}`, refundErr)
        }
        throw adkErr
      }

      // 3. GET BALANCE — graceful degrade if this fails
      let newBalance: number | null = null
      try {
        newBalance = await cs.getBalance(userId)
      } catch (balErr) {
        console.warn(`getBalance failed user=${userId}, returning null snapshot`, balErr)
      }

      // 4. RESPOND
      res.json({
        reply: result.reply,
        toolCalls: result.toolCalls,
        usageSnapshot: newBalance !== null ? { remainingCredits: newBalance } : null,
        groundingMetadata: result.groundingMetadata,
      })
    } catch (err) {
      console.error('agent/run error:', err)
      const errorMessage = err instanceof Error ? err.message : 'Internal server error'
      // Treat Cloud Run (K_SERVICE) as production by default since Cloud Run
      // does not typically set NODE_ENV. Leak details only in dev/test envs.
      const isProd = !!process.env.K_SERVICE || process.env.NODE_ENV === 'production'
      res.status(500).json({
        error: isProd ? 'Internal server error' : errorMessage,
      })
    }
  })

  const usesDefaultDeviceUpsert = !options.upsertDevice
  const browserBridgeAvailable = admin.apps.length > 0

  const upsertDevice = options.upsertDevice ?? (async (uid, body) => {
    await upsertDeviceRecord(admin.firestore(), uid, body)
  })

  app.post('/agent/browser/register-device', authRouteLimiter, requireAuth, async (req: Request & { uid?: string }, res: Response): Promise<void> => {
    if (usesDefaultDeviceUpsert && !browserBridgeAvailable) {
      res.status(503).json({ error: 'Browser bridge unavailable' })
      return
    }
    const parsed = z.object({
      fcmToken: z.string().min(1),
      deviceId: z.string().min(1),
      deviceName: z.string().min(1),
      isPaused: z.boolean().optional(),
    }).safeParse(req.body)
    if (!parsed.success) { res.status(400).json({ error: 'Invalid request body' }); return }
    try {
      await upsertDevice(req.uid!, parsed.data)
      res.json({ ok: true })
    } catch (err) {
      console.error('register-device error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  app.post('/agent/user/expo-push-token', authRouteLimiter, requireAuth, async (req: Request & { uid?: string }, res: Response): Promise<void> => {
    const parsed = z.object({ expoPushToken: z.string().min(1) }).safeParse(req.body)
    if (!parsed.success) { res.status(400).json({ error: 'Invalid request body' }); return }
    try {
      await upsertExpoPushToken(db, req.uid!, parsed.data.expoPushToken)
      res.json({ ok: true })
    } catch (err) {
      console.error('expo-push-token upsert error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  app.post('/agent/browser/approve-action', authRouteLimiter, requireAuth, async (req: Request & { uid?: string }, res: Response): Promise<void> => {
    if (!browserBridgeAvailable) { res.status(503).json({ error: 'Browser bridge unavailable' }); return }
    const parsed = z.object({
      sessionId: z.string().uuid(),
      taskId: z.string().min(1),
      approve: z.boolean(),
    }).safeParse(req.body)
    if (!parsed.success) { res.status(400).json({ error: 'Invalid request body' }); return }

    const authHeader = req.headers.authorization ?? ''
    const rawToken = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : ''
    if (!rawToken) { res.status(401).json({ error: 'Unauthorized' }); return }
    try {
      await handleApproveAction(
        admin.firestore() as unknown as { doc(p: string): { update(d: Record<string, unknown>): Promise<void> } },
        req.uid!,
        parsed.data,
      )
      res.json({ ok: true })
    } catch (err) {
      console.error('approve-action error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  app.post('/agent/browser/scheduler-trigger', schedulerTriggerLimiter, async (req: Request, res: Response): Promise<void> => {
    const secret = process.env.SCHEDULER_SECRET
    if (!secret) {
      res.status(503).json({ error: 'Scheduler trigger not configured' })
      return
    }
    if (!isSchedulerAuthorized(req, secret)) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    if (!browserBridgeAvailable) {
      res.status(503).json({ error: 'Browser bridge unavailable' })
      return
    }
    const handler = createSchedulerTriggerHandler(
      defaultFirestoreSession(),
      defaultFcmDispatcher(),
      (firebaseUid: string) => getExpoPushToken(db, firebaseUid),
      cs,
      async (firebaseUid: string) => {
        const [u] = await db.select({ id: users.id }).from(users).where(eq(users.firebaseUid, firebaseUid))
        return u?.id ?? null
      },
      { secret },
    )
    return handler(req, res)
  })

  return app
}

export function attachWebSocketRoutes(server: Server, options: AppOptions): void {
  const { verifyToken, db, wsHandlerOptions, wsLiveHandlerOptions, creditService } = options
  const browserBridgeAvailable = admin.apps.length > 0
  const streamWss = new WebSocketServer({ noServer: true })
  const liveWss = new WebSocketServer({ noServer: true })
  const browserWss = new WebSocketServer({ noServer: true })

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
    } else if (pathname === '/agent/browser') {
      if (!browserBridgeAvailable) {
        socket.destroy()
        return
      }
      browserWss.handleUpgrade(req, socket, head, (ws) => {
        handleBrowserWsUpgrade(ws, req, {
          firestoreSession: defaultFirestoreSession(),
          fcmDispatcher: defaultFcmDispatcher(),
          verifyToken,
          resolveUserId: async (firebaseUid: string) => {
            const [u] = await db.select({ id: users.id }).from(users).where(eq(users.firebaseUid, firebaseUid))
            return u ? firebaseUid : null
          },
          getExpoPushToken: (firebaseUid: string) => getExpoPushToken(db, firebaseUid),
          getDeviceFcmToken: async (uid: string, deviceId: string) => {
            const snap = await admin.firestore().doc(`users/${uid}/devices/${deviceId}`).get()
            if (!snap.exists) return null
            return (snap.data()?.fcmToken as string) ?? null
          },
          validateDevice: async (firebaseUid: string, deviceId: string) => {
            const doc = await admin.firestore().doc(`users/${firebaseUid}/devices/${deviceId}`).get()
            const data = doc.data()
            return doc.exists && data?.active === true && data?.isPaused !== true
          },
          instanceId: INSTANCE_ID,
        })
      })
    } else {
      socket.destroy()
    }
  })
}

// ── Entry point ───────────────────────────────────────────────────────────────

if (process.env.NODE_ENV !== 'test') {
  const isMockAuth = process.env.MOCK_FIREBASE_AUTH === 'true' && process.env.NODE_ENV !== 'production' && !process.env.K_SERVICE
  
  if (isMockAuth) {
    console.log('--- Auth Debug ---');
    console.log(`MOCK_FIREBASE_AUTH: ${process.env.MOCK_FIREBASE_AUTH} (type: ${typeof process.env.MOCK_FIREBASE_AUTH})`);
    console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
    console.log(`K_SERVICE: ${process.env.K_SERVICE}`);
    console.log(`isMockAuth evaluated to: ${isMockAuth}`);
    console.log('------------------');
  }

  if (!isMockAuth && !admin.apps.length) admin.initializeApp()

  const db = await getDb()
  const verifyToken = isMockAuth
    ? async (_token: string) => ({ uid: 'local_test_user_123' })
    : (token: string) => admin.auth().verifyIdToken(token).then((d) => ({ uid: d.uid }))
  const appOptions = { verifyToken, db, runAgentFn: runAgentReal }

  const app = createApp(appOptions)

  const port = process.env.PORT ?? '8080'
  const server = app.listen(Number(port), '0.0.0.0', () => {
    console.log(`Cloud Agent listening on port ${port}`)
  })
  attachWebSocketRoutes(server, appOptions)
}
