import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import { rateLimit } from 'express-rate-limit'
import admin from 'firebase-admin'
import { eq, and, ilike } from 'drizzle-orm'
import { InMemoryRunner, isFinalResponse, createEvent, createEventActions } from '@google/adk'
import type { Content } from '@google/genai'
import { getDb } from './db/client.js'
import { buildAgent } from './agent.js'
import { users, characters, llmWikiEvents, tasks } from './db/schema.js'
import type { DrizzleClient } from './db/client.js'
import { z } from 'zod'

const contentSchema = z.object({
  role: z.enum(['user', 'model']),
  parts: z.array(z.object({}).passthrough()).min(1),
})

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RunAgentParams {
  db: DrizzleClient
  userId: string
  characterId: string
  systemInstruction: string
  message: string
  history: Content[]
}

interface AppOptions {
  verifyToken: (token: string) => Promise<{ uid: string }>
  db: DrizzleClient
  runAgentFn: (params: RunAgentParams) => Promise<{ reply: string; toolCalls: string[] }>
}

type UnsyncedTask = { type: 'task'; id: string; title: string; status: string; createdAt: number }
type UnsyncedWikiEvent = { type: 'wiki_event'; id: string; eventType: string; summary: string; createdAt: number }
type UnsyncedItem = UnsyncedTask | UnsyncedWikiEvent

// ── Helpers ───────────────────────────────────────────────────────────────────

// Maps local SQLite task status 'pending' to cloud-side 'open'; local uses
// 'pending' as the default but Cloud SQL tasks only allow ('open','done','abandoned').
// Clamps to allowed values to prevent constraint violations.
function toCloudStatus(status: string): string {
  const normalized = status === 'pending' ? 'open' : (status || 'open')
  return ['open', 'done', 'abandoned'].includes(normalized) ? normalized : 'open'
}

// Accepts both second and millisecond epoch timestamps.
// If value > 9999999999 (Nov 2286 in seconds), assume milliseconds.
function toCloudTimestamp(epoch: number): Date {
  return new Date(epoch > 9999999999 ? epoch : epoch * 1000)
}

async function bulkInsertUnsynced(
  db: DrizzleClient,
  userId: string,
  characterId: string,
  items: unknown[],
): Promise<void> {
  const taskRows: Array<{
    id: string;
    characterId: string;
    userId: string;
    title: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }> = []
  const wikiRows: Array<{
    id: string;
    entityId: string;
    userId: string;
    eventType: string;
    summary: string;
    createdAt: number;
  }> = []

  for (const raw of items) {
    if (typeof raw !== 'object' || raw === null) continue
    const item = raw as UnsyncedItem
    if (item.type === 'task') {
      if (typeof item.id !== 'string' || !item.id.trim()) continue
      if (typeof item.title !== 'string' || !item.title.trim()) continue
      if (typeof item.createdAt !== 'number') continue
      taskRows.push({
        id: item.id.trim(),
        characterId,
        userId,
        title: item.title.trim(),
        status: toCloudStatus(item.status),
        createdAt: toCloudTimestamp(item.createdAt),
        updatedAt: new Date(),
      })
    } else if (item.type === 'wiki_event') {
      if (typeof item.id !== 'string' || !item.id.trim()) continue
      if (typeof item.summary !== 'string' || !item.summary.trim()) continue
      if (typeof item.createdAt !== 'number') continue
      const allowedEvents = ['observation', 'decision', 'action', 'outcome'] as const
      type AllowedEvent = (typeof allowedEvents)[number]
      const eventType = allowedEvents.includes(item.eventType as AllowedEvent)
        ? item.eventType
        : 'observation'
      wikiRows.push({
        id: item.id.trim(),
        entityId: characterId,
        userId,
        eventType,
        summary: item.summary.trim(),
        createdAt: toCloudTimestamp(item.createdAt).getTime(),
      })
    }
  }

  if (taskRows.length > 0) {
    await db.insert(tasks).values(taskRows).onConflictDoNothing()
  }
  if (wikiRows.length > 0) {
    await db.insert(llmWikiEvents).values(wikiRows).onConflictDoNothing()
  }
}

async function queryWikiContext(db: DrizzleClient, query: string, userId: string, characterId: string): Promise<string> {
  const normalizedQuery = query.trim().slice(0, 200)
  if (!normalizedQuery) return ''

  const rows = await db
    .select({ summary: llmWikiEvents.summary })
    .from(llmWikiEvents)
    .where(
      and(
        eq(llmWikiEvents.entityId, characterId),
        eq(llmWikiEvents.userId, userId),
        ilike(llmWikiEvents.summary, `%${normalizedQuery}%`),
      ),
    )
    .limit(5)
  if (rows.length === 0) return ''
  return rows.map((r) => `- ${r.summary}`).join('\n')
}

function assembleSystemInstruction(
  character: { name: string; appearance: string | null; traits: string | null; emotions: string | null; context: string | null },
  wikiContext: string,
): string {
  return [
    `You are ${character.name}.`,
    character.appearance && `Appearance: ${character.appearance}`,
    character.traits && `Traits: ${character.traits}`,
    character.emotions && `Emotions: ${character.emotions}`,
    character.context && `Context: ${character.context}`,
    wikiContext && `\nKnown facts about the user:\n${wikiContext}`,
  ]
    .filter(Boolean)
    .join('\n')
}

// ── Real agent runner (production) ────────────────────────────────────────────

async function runAgentReal(params: RunAgentParams): Promise<{ reply: string; toolCalls: string[] }> {
  const { db, userId, characterId, systemInstruction, message, history } = params
  const agent = buildAgent(db, userId, characterId, systemInstruction)
  const runner = new InMemoryRunner({ agent, appName: 'clanker-cloud-agent' })
  const sessionId = crypto.randomUUID()

  if (history.length > 0) {
    const session = await runner.sessionService.createSession({
      appName: 'clanker-cloud-agent',
      userId,
      sessionId,
    })
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
  return { reply, toolCalls }
}

// ── App factory ───────────────────────────────────────────────────────────────

function corsOrigins(): string | string[] | boolean {
  const raw = process.env.CORS_ORIGIN
  // Default to true (reflect origin) so Expo web can reach Cloud Run without
  // explicit CORS_ORIGIN configuration; Firebase auth provides the access control.
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

  if (origins.some((o) => o === '*')) return '*'
  return origins.length > 0 ? origins : false
}

export function createApp(options: AppOptions) {
  const { verifyToken, db, runAgentFn } = options
  const app = express()
  // trust proxy is required behind Cloud Run's managed load balancer so that
  // rate-limiting sees the real client IP via X-Forwarded-For. Cloud Run always
  // sets K_SERVICE; fall back to an explicit TRUST_PROXY flag for other envs.
  if (process.env.K_SERVICE || process.env.TRUST_PROXY === '1') {
    app.set('trust proxy', 1)
  }
  app.use(cors({ origin: corsOrigins() }))
  app.use(express.json())

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' })
  })

  const requireAuth = async (
    req: Request & { uid?: string },
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const authHeader = req.headers.authorization ?? ''
    const match = authHeader.match(/^Bearer\s+(.+)$/i)
    const token = match?.[1]
    if (!token) { res.status(401).json({ error: 'Unauthorized' }); return }
    try {
      const decoded = await verifyToken(token)
      req.uid = decoded.uid
      next()
    } catch {
      res.status(401).json({ error: 'Unauthorized' })
    }
  }

  const agentRunLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req: Request, res: Response) => {
      res.status(429).json({ error: 'Too many requests. Please try again later.' })
    },
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

      // Map Firebase UID → DB user UUID (users.id is UUID; firebase_uid is the token uid)
      const [dbUser] = await db.select({ id: users.id }).from(users).where(eq(users.firebaseUid, firebaseUid))
      if (!dbUser) { res.status(401).json({ error: 'Unauthorized' }); return }
      const userId = dbUser.id

      // Verify character exists and belongs to this user before any writes
      const [character] = await db.select().from(characters).where(
        and(eq(characters.id, characterId), eq(characters.userId, userId))
      )
      if (!character) { res.status(404).json({ error: 'Character not found' }); return }

      if (unsyncedHistory.length > 0) {
        try {
          await bulkInsertUnsynced(db, userId, characterId, unsyncedHistory)
        } catch (err) {
          // Swallow sync errors so the agent can still respond (matches Firebase generateReply behavior)
          console.error('bulkInsertUnsynced failed:', err)
        }
      }

      const wikiContext = await queryWikiContext(db, message, userId, characterId)
      const systemInstruction = assembleSystemInstruction(character, wikiContext)

      const result = await runAgentFn({ db, userId, characterId, systemInstruction, message, history })
      res.json(result)
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

  return app
}

// ── Entry point ───────────────────────────────────────────────────────────────

if (process.env.NODE_ENV !== 'test') {
  if (!admin.apps.length) admin.initializeApp()

  const db = await getDb()
  const app = createApp({
    verifyToken: (token) => admin.auth().verifyIdToken(token).then((d) => ({ uid: d.uid })),
    db,
    runAgentFn: runAgentReal,
  })

  const port = process.env.PORT ?? '8080'
  app.listen(Number(port), '0.0.0.0', () => {
    console.log(`Cloud Agent listening on port ${port}`)
  })
}
