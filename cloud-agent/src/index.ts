import express, { Request, Response, NextFunction } from 'express'
import type { IncomingMessage, Server } from 'http'
import cors from 'cors'
import { rateLimit } from 'express-rate-limit'
import { getApps, initializeApp } from 'firebase-admin/app'
import { services } from './firebaseAdmin.js'
import { eq, and } from 'drizzle-orm'
import { InMemoryRunner, createEvent, createEventActions } from '@google/adk'
import type { Content, GroundingMetadata } from '@google/genai'
import { WebSocketServer } from 'ws'
import { getDb } from './db/client.js'
import { buildAgent } from './agent.js'
import { assembleSystemInstruction, queryWikiContext } from './services/agentCore.js'
import { bulkInsertUnsynced } from './services/unsyncedHistory.js'
import { users, characters } from './db/schema.js'
import { embedText } from './db/embeddings.js'
import type { DrizzleClient } from './db/client.js'
import { createCreditService } from './services/creditService.js'
import type { CreditService } from './services/creditService.js'
import {
  assertAgentTurnCredits,
  AgentInsufficientCreditsError,
  consumeAgentEvents,
  type ConsumeAgentEventsResult,
} from './services/agentEventLoop.js'
import { handleWsUpgrade, type WsHandlerOptions } from './handlers/wsAgentHandler.js'
import { handleLiveWsUpgrade, type WsLiveHandlerOptions } from './handlers/wsLiveAgentHandler.js'
import { handleBrowserWsUpgrade } from './handlers/wsBrowserAgentHandler.js'
import { handleDesktopWsUpgrade } from './handlers/wsDesktopAgentHandler.js'
import { defaultFirestoreSession } from './services/firestoreSession.js'
import { defaultFcmDispatcher } from './services/fcmDispatcher.js'
import { desktopBridge } from './services/desktopBridge.js'
import {
  pairDesktopDevice,
  revokeDesktopDevice,
  resolvePairingToken,
  type PairingFirestore,
} from './services/desktopPairing.js'
import { createVaultToolDeps } from './tools/vaultTools.js'
import { upsertDeviceRecord } from './services/deviceUpsert.js'
import { getExpoPushToken } from './handlers/expoPushToken.js'
import { handleApproveAction } from './handlers/approveAction.js'
import {
  createSchedulerTriggerHandler,
  createRequireSchedulerSecret,
} from './handlers/schedulerTriggerHandler.js'
import { INSTANCE_ID } from './services/instanceId.js'
import { mapAgentExecutionError } from './utils/agentExecutionError.js'
import { z } from 'zod'
import { agentRunSchema } from '../../shared/cloudAgentProtocol.js'
import { MAX_AGENT_RUN_BODY_BYTES } from '../../shared/cloudAgentAttachments.js'
import type { AgentAttachment } from '../../shared/cloudAgentProtocol.js'
import { buildNewMessage } from './agentMessage.js'
import {
  refundGeneratedImages,
  type GeneratedImage,
  type VertexImageGenerator,
} from './tools/generateImage.js'

export { INSTANCE_ID } from './services/instanceId.js'

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
  creditService: Pick<CreditService, 'spendCredit' | 'refundCredit'>
  /** Test hook: replaces defaultVertexImageGenerator inside buildAgent. */
  imageGenerator?: VertexImageGenerator
  /** At most one in Phase 2; delivered as a leading inlineData part. */
  attachments?: AgentAttachment[]
}

export interface AppOptions {
  verifyToken: (token: string) => Promise<{ uid: string }>
  db: DrizzleClient
  runAgentFn: (params: RunAgentParams) => Promise<{
    reply: string
    toolCalls: string[]
    groundingMetadata?: GroundingMetadata
    /** Present when the agent called generate_image this run (§6.3 HTTP parity). */
    generatedImage?: GeneratedImage | null
  }>
  creditService?: CreditService
  wsHandlerOptions?: Partial<WsHandlerOptions>
  wsLiveHandlerOptions?: Partial<WsLiveHandlerOptions>
  upsertDevice?: (
    uid: string,
    body: { fcmToken: string; deviceId: string; deviceName: string; isPaused?: boolean },
  ) => Promise<void>
}

// ── Real agent runner (production) ────────────────────────────────────────────

export async function runAgentReal(params: RunAgentParams): Promise<{
  reply: string
  toolCalls: string[]
  groundingMetadata?: GroundingMetadata
  /** Present when the agent called generate_image this run (§6.3 HTTP parity). */
  generatedImage?: GeneratedImage | null
}> {
  const {
    db,
    userId,
    firebaseUid,
    characterId,
    systemInstruction,
    message,
    history,
    timezone,
    embed,
    creditService,
    imageGenerator,
    attachments = [],
  } = params
  const bridge = getApps().length
    ? {
        firebaseUid,
        userId,
        firestoreSession: defaultFirestoreSession(),
        fcmDispatcher: defaultFcmDispatcher(),
        creditService: createCreditService(db),
        instanceId: INSTANCE_ID,
      }
    : undefined
  const vault = getApps().length
    ? createVaultToolDeps({
        firebaseUid,
        firestoreSession: defaultFirestoreSession(),
        desktopBridge,
      })
    : undefined
  const { agent, imageCollector, imageSpendAllocations } = buildAgent(
    db,
    userId,
    characterId,
    systemInstruction,
    timezone,
    embed,
    bridge,
    vault,
    { creditService, imageGenerator },
  )
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
  })

  let consumed: ConsumeAgentEventsResult
  try {
    consumed = await consumeAgentEvents(events, userId, creditService)
  } catch (err) {
    // §7: if generate_image already succeeded this run, its spend sits outside
    // consumeAgentEvents' own refund scope — return it before rethrowing so
    // the route's 500 never keeps the image's credits.
    await refundGeneratedImages(userId, creditService, imageCollector, imageSpendAllocations)
    throw err
  }
  return {
    ...consumed,
    // Post-loop delivery point (§6.3): at most one image per run.
    generatedImage: imageCollector.length > 0 ? imageCollector[0] : null,
  }
}

// ── App factory ───────────────────────────────────────────────────────────────

function corsOrigins(): string | string[] | boolean {
  const raw = process.env.CORS_ORIGIN
  // No env var → deny all cross-origin browser access. The only clients today
  // are the Expo mobile app and server-to-server callers, neither of which is
  // subject to CORS; a browser-based client must opt in via an explicit allowlist.
  if (!raw) return false

  const origins = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((value) => {
      if (value.toLowerCase().startsWith('chrome-extension://')) {
        return value.replace(/\/$/, '')
      }
      try {
        return new URL(value).origin
      } catch {
        return value.replace(/\/$/, '')
      }
    })

  const filtered = origins.filter((o) => o !== '*')
  return filtered.length > 0 ? filtered : false
}

/**
 * Compute the server's own origin from the upgrade request.
 *
 * React Native 0.86.2's Android WebSocketModule synthesizes
 * `Origin: https://<endpoint>` when the JS client does not supply one
 * (see `node_modules/react-native/ReactAndroid/.../WebSocketModule.kt` —
 * `getDefaultOrigin` maps `wss://` to `https://` and `ws://` to `http://`,
 * emitting the host and the explicit port). Same-origin browsers send the
 * same value. The Cloud Run and local-dev hosts therefore both round-trip
 * through this helper, letting the native mobile app and `localhost:8081`
 * dev connect without configuring `CORS_ORIGIN`.
 */
export function selfOrigin(req: IncomingMessage): string | null {
  const host = req.headers.host
  if (!host) return null
  let scheme: 'http' | 'https'
  if ((req.socket as { encrypted?: boolean }).encrypted) {
    scheme = 'https'
  } else {
    // Behind a TLS-terminating proxy (Cloud Run, any managed LB) the public
    // scheme is https but `req.socket.encrypted` is false inside the container.
    // `trust proxy` is set for K_SERVICE in `createApp`, so X-Forwarded-Proto
    // from the immediate hop is trustworthy here. Take the first value to be
    // robust against an upstream chain that has already prepended entries.
    const xfp = req.headers['x-forwarded-proto']
    const forwarded = Array.isArray(xfp) ? xfp[0] : xfp
    scheme = forwarded?.split(',')[0]?.trim() === 'https' ? 'https' : 'http'
  }
  return `${scheme}://${host}`
}

export function isAllowedWsOrigin(origin: string | undefined, self: string | null): boolean {
  // Native clients and server-to-server callers send no Origin header. They are
  // not browsers, so the same-origin model does not apply to them; they are
  // gated by bearer-token auth inside the individual upgrade handlers.
  if (!origin) return true

  // See `selfOrigin` above — the request's own origin is always allowed.
  if (self && origin === self) return true

  const allowed = corsOrigins()
  if (allowed === false) return false
  if (allowed === true) return true // unreachable today; guards future changes
  const list = Array.isArray(allowed) ? allowed : [allowed]
  return list.includes(origin)
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
  app.use(express.json({ limit: MAX_AGENT_RUN_BODY_BYTES }))

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
    if (!token) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
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

  app.post(
    '/agent/run',
    agentRunLimiter,
    requireAuth,
    async (req: Request & { uid?: string }, res: Response): Promise<void> => {
      try {
        const parseResult = agentRunSchema.safeParse(req.body)
        if (!parseResult.success) {
          res.status(400).json({ error: 'Invalid request body' })
          return
        }
        const {
          message,
          characterId,
          unsyncedHistory = [],
          history: rawHistory = [],
          attachments = [],
        } = parseResult.data
        const history = rawHistory as Content[]
        const firebaseUid = req.uid!
        const timezone =
          typeof req.headers['x-timezone'] === 'string' ? req.headers['x-timezone'].trim() : 'UTC'

        // Map Firebase UID → DB user UUID (users.id is UUID; firebase_uid is the token uid)
        const [dbUser] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.firebaseUid, firebaseUid))
        if (!dbUser) {
          res.status(401).json({ error: 'Unauthorized' })
          return
        }
        const userId = dbUser.id

        // Verify character exists and belongs to this user before any writes
        const [character] = await db
          .select()
          .from(characters)
          .where(and(eq(characters.id, characterId), eq(characters.userId, userId)))
        if (!character) {
          res.status(404).json({ error: 'Character not found' })
          return
        }

        if (unsyncedHistory.length > 0) {
          try {
            await bulkInsertUnsynced(db, userId, characterId, unsyncedHistory, embedText)
          } catch (err) {
            // Swallow sync errors so the agent can still respond (matches Firebase generateReply behavior)
            console.error('bulkInsertUnsynced failed:', err)
          }
        }

        try {
          await assertAgentTurnCredits(userId, cs)
        } catch (creditErr) {
          if (creditErr instanceof AgentInsufficientCreditsError) {
            res.status(402).json({ error: 'Insufficient credits' })
            return
          }
          throw creditErr
        }

        const wikiContext = await queryWikiContext(db, message, userId, characterId, embedText)
        const systemInstruction = assembleSystemInstruction(character, wikiContext)

        // Credit spend happens per internal ADK loop iteration inside runAgentFn
        // (see services/agentEventLoop.ts); the loop refunds its own spends on
        // failure, and runAgentReal additionally refunds a generated image's
        // spend before rethrowing (spec §7).
        const result = await runAgentFn({
          db,
          userId,
          firebaseUid,
          characterId,
          systemInstruction,
          message,
          history,
          timezone,
          embed: embedText,
          creditService: cs,
          attachments,
        })

        // GET BALANCE — graceful degrade if this fails
        let newBalance: number | null = null
        try {
          newBalance = await cs.getBalance(userId)
        } catch (balErr) {
          console.warn(`getBalance failed user=${userId}, returning null snapshot`, balErr)
        }

        // RESPOND — generatedImage mirrors the WS agent_image frame: { imageBase64, mimeType }
        res.json({
          reply: result.reply,
          toolCalls: result.toolCalls,
          usageSnapshot: newBalance !== null ? { remainingCredits: newBalance } : null,
          groundingMetadata: result.groundingMetadata,
          generatedImage: result.generatedImage ?? null,
        })
      } catch (err) {
        console.error('agent/run error:', err)
        const isProd = !!process.env.K_SERVICE || process.env.NODE_ENV === 'production'
        if (isProd) {
          res.status(500).json({ error: 'Internal server error' })
          return
        }
        const mapped = mapAgentExecutionError(err)
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Internal server error',
          code: mapped.code,
          message: mapped.message,
        })
      }
    },
  )

  const usesDefaultDeviceUpsert = !options.upsertDevice
  const browserBridgeAvailable = getApps().length > 0

  const upsertDevice =
    options.upsertDevice ??
    (async (uid, body) => {
      await upsertDeviceRecord(services.firestore, uid, body)
    })

  app.post(
    '/agent/browser/register-device',
    authRouteLimiter,
    requireAuth,
    async (req: Request & { uid?: string }, res: Response): Promise<void> => {
      if (usesDefaultDeviceUpsert && !browserBridgeAvailable) {
        res.status(503).json({ error: 'Browser bridge unavailable' })
        return
      }
      const parsed = z
        .object({
          fcmToken: z.string().min(1),
          deviceId: z.string().min(1),
          deviceName: z.string().min(1),
          isPaused: z.boolean().optional(),
        })
        .safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request body' })
        return
      }
      try {
        await upsertDevice(req.uid!, parsed.data)
        res.json({ ok: true })
      } catch (err) {
        console.error('register-device error:', err)
        res.status(500).json({ error: 'Internal server error' })
      }
    },
  )

  app.post(
    '/agent/desktop/pair',
    authRouteLimiter,
    requireAuth,
    async (req: Request & { uid?: string }, res: Response): Promise<void> => {
      if (!browserBridgeAvailable) {
        res.status(503).json({ error: 'Desktop bridge unavailable' })
        return
      }
      const parsed = z.object({ deviceName: z.string().trim().min(1).max(100) }).safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request body' })
        return
      }
      try {
        const { pairingToken, deviceId } = await pairDesktopDevice(
          services.firestore as unknown as PairingFirestore,
          req.uid!,
          parsed.data.deviceName,
        )
        res.json({ pairingToken, deviceId })
      } catch (err) {
        console.error('desktop pair error:', err)
        res.status(500).json({ error: 'Internal server error' })
      }
    },
  )

  app.post(
    '/agent/desktop/revoke',
    authRouteLimiter,
    requireAuth,
    async (req: Request & { uid?: string }, res: Response): Promise<void> => {
      if (!browserBridgeAvailable) {
        res.status(503).json({ error: 'Desktop bridge unavailable' })
        return
      }
      const parsed = z.object({ deviceId: z.string().uuid() }).safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request body' })
        return
      }
      try {
        await revokeDesktopDevice(
          services.firestore as unknown as PairingFirestore,
          req.uid!,
          parsed.data.deviceId,
        )
        res.json({ ok: true })
      } catch (err) {
        console.error('desktop revoke error:', err)
        res.status(500).json({ error: 'Internal server error' })
      }
    },
  )

  app.post(
    '/agent/browser/approve-action',
    authRouteLimiter,
    requireAuth,
    async (req: Request & { uid?: string }, res: Response): Promise<void> => {
      if (!browserBridgeAvailable) {
        res.status(503).json({ error: 'Browser bridge unavailable' })
        return
      }
      const parsed = z
        .object({
          sessionId: z.string().uuid(),
          taskId: z.string().min(1),
          approve: z.boolean(),
        })
        .safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request body' })
        return
      }

      const authHeader = req.headers.authorization ?? ''
      const rawToken = authHeader.toLowerCase().startsWith('bearer ')
        ? authHeader.slice(7).trim()
        : ''
      if (!rawToken) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }
      try {
        await handleApproveAction(
          services.firestore as unknown as {
            doc(p: string): { update(d: Record<string, unknown>): Promise<void> }
          },
          req.uid!,
          { ...parsed.data, approvalToken: rawToken },
        )
        res.json({ ok: true })
      } catch (err) {
        console.error('approve-action error:', err)
        res.status(500).json({ error: 'Internal server error' })
      }
    },
  )

  let schedulerHandler: ReturnType<typeof createSchedulerTriggerHandler> | undefined

  app.post(
    '/agent/browser/scheduler-trigger',
    schedulerTriggerLimiter,
    (req: Request, res: Response, next: NextFunction): void => {
      const secret = process.env.SCHEDULER_SECRET
      if (!secret) {
        res.status(503).json({ error: 'Scheduler trigger not configured' })
        return
      }
      createRequireSchedulerSecret(secret)(req, res, next)
    },
    (req: Request, res: Response, next: NextFunction): void => {
      if (!browserBridgeAvailable) {
        res.status(503).json({ error: 'Browser bridge unavailable' })
        return
      }
      next()
    },
    (req: Request, res: Response): void => {
      if (!schedulerHandler) {
        schedulerHandler = createSchedulerTriggerHandler(
          defaultFirestoreSession(),
          defaultFcmDispatcher(),
          (firebaseUid: string) => getExpoPushToken(db, firebaseUid),
          cs,
          async (firebaseUid: string) => {
            const [u] = await db
              .select({ id: users.id })
              .from(users)
              .where(eq(users.firebaseUid, firebaseUid))
            return u?.id ?? null
          },
          { schedulerTimeoutMs: 90_000 },
        )
      }
      void schedulerHandler(req, res)
    },
  )

  return app
}

export function attachWebSocketRoutes(server: Server, options: AppOptions): void {
  const { verifyToken, db, wsHandlerOptions, wsLiveHandlerOptions, creditService } = options
  const browserBridgeAvailable = getApps().length > 0
  // `/agent/stream` takes the same agentRun payload as `/agent/run`, so it gets
  // the same ceiling — `ws` would otherwise buffer and parse up to its 100 MiB
  // default before the schema ever runs. The live, browser and desktop sockets
  // carry audio frames and browser-bridge results, which have no equivalent
  // documented bound; capping them blind risks cutting off voice and screenshot
  // payloads, so they are deliberately left at the library default.
  const streamWss = new WebSocketServer({ noServer: true, maxPayload: MAX_AGENT_RUN_BODY_BYTES })
  const liveWss = new WebSocketServer({ noServer: true })
  const browserWss = new WebSocketServer({ noServer: true })
  const desktopWss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    if (!isAllowedWsOrigin(req.headers.origin, selfOrigin(req))) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      return
    }
    const pathname = new URL(req.url ?? '', `http://${req.headers.host}`).pathname

    if (pathname === '/agent/stream') {
      streamWss.handleUpgrade(req, socket, head, (ws) => {
        void handleWsUpgrade(ws, req, { db, verifyToken, creditService, ...wsHandlerOptions })
      })
    } else if (pathname === '/agent/live') {
      liveWss.handleUpgrade(req, socket, head, (ws) => {
        void handleLiveWsUpgrade(ws, req, {
          db,
          verifyToken,
          creditService,
          ...wsLiveHandlerOptions,
        })
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
            const [u] = await db
              .select({ id: users.id })
              .from(users)
              .where(eq(users.firebaseUid, firebaseUid))
            return u ? firebaseUid : null
          },
          getExpoPushToken: (firebaseUid: string) => getExpoPushToken(db, firebaseUid),
          getDeviceFcmToken: async (uid: string, deviceId: string) => {
            const snap = await services.firestore.doc(`users/${uid}/devices/${deviceId}`).get()
            if (!snap.exists) return null
            return (snap.data()?.fcmToken as string) ?? null
          },
          validateDevice: async (firebaseUid: string, deviceId: string) => {
            const doc = await services.firestore
              .doc(`users/${firebaseUid}/devices/${deviceId}`)
              .get()
            const data = doc.data()
            return doc.exists && data?.active === true && data?.isPaused !== true
          },
          instanceId: INSTANCE_ID,
        })
      })
    } else if (pathname === '/agent/desktop') {
      if (!browserBridgeAvailable) {
        socket.destroy()
        return
      }
      desktopWss.handleUpgrade(req, socket, head, (ws) => {
        handleDesktopWsUpgrade(ws, req, {
          firestoreSession: defaultFirestoreSession(),
          desktopBridge,
          resolvePairingToken: (raw: string) =>
            resolvePairingToken(services.firestore as unknown as PairingFirestore, raw),
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
  const isMockAuth =
    process.env.MOCK_FIREBASE_AUTH === 'true' &&
    process.env.NODE_ENV !== 'production' &&
    !process.env.K_SERVICE

  if (isMockAuth) {
    console.log('--- Auth Debug ---')
    console.log(
      `MOCK_FIREBASE_AUTH: ${process.env.MOCK_FIREBASE_AUTH} (type: ${typeof process.env.MOCK_FIREBASE_AUTH})`,
    )
    console.log(`NODE_ENV: ${process.env.NODE_ENV}`)
    console.log(`K_SERVICE: ${process.env.K_SERVICE}`)
    console.log(`isMockAuth evaluated to: ${isMockAuth}`)
    console.log('------------------')
  }

  if (!isMockAuth && !getApps().length) initializeApp()

  const db = await getDb()
  const verifyToken = isMockAuth
    ? async (_token: string) => ({ uid: 'local_test_user_123' })
    : (token: string) =>
        services.auth.verifyIdToken(token).then((d: { uid: string }) => ({ uid: d.uid }))
  const appOptions = { verifyToken, db, runAgentFn: runAgentReal }

  const app = createApp(appOptions)

  const port = process.env.PORT ?? '8080'
  const server = app.listen(Number(port), '0.0.0.0', () => {
    console.log(`Cloud Agent listening on port ${port}`)
  })
  attachWebSocketRoutes(server, appOptions)
}
