import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import { rateLimit } from 'express-rate-limit'
import admin from 'firebase-admin'
import { eq, and, isNull, sql } from 'drizzle-orm'
import { InMemoryRunner, isFinalResponse, createEvent, createEventActions } from '@google/adk'
import type { Content } from '@google/genai'
import { getDb } from './db/client.js'
import { buildAgent } from './agent.js'
import { users, characters, llmWikiEvents, llmWikiEntries, tasks } from './db/schema.js'
import { embedText } from './db/embeddings.js'
import type { DrizzleClient } from './db/client.js'
import { createCreditService } from './services/creditService.js'
import type { CreditService } from './services/creditService.js'
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
  timezone: string
  embed: (text: string) => Promise<number[]>
}

interface AppOptions {
  verifyToken: (token: string) => Promise<{ uid: string }>
  db: DrizzleClient
  runAgentFn: (params: RunAgentParams) => Promise<{ reply: string; toolCalls: string[] }>
  creditService?: CreditService
}

type UnsyncedTask = { type: 'task'; id: string; title: string; status: string; createdAt: number }
type UnsyncedWikiEntry = { type: 'wiki_entry'; id: string; title: string; body: string; confidence?: string; sourceType?: string; createdAt: number; updatedAt: number }
type UnsyncedWikiEvent = { type: 'wiki_event'; id: string; eventType: string; summary: string; createdAt: number }
type UnsyncedItem = UnsyncedTask | UnsyncedWikiEntry | UnsyncedWikiEvent

// ── Helpers ───────────────────────────────────────────────────────────────────

// Maps local SQLite task status 'pending' to cloud-side 'open'; local uses
// 'pending' as the default but Cloud SQL tasks only allow ('open','done','abandoned').
// Clamps to allowed values to prevent constraint violations.
function toCloudStatus(status: string): string {
  const normalized = status === 'pending' ? 'open' : (status || 'open')
  return ['open', 'done', 'abandoned'].includes(normalized) ? normalized : 'open'
}

// Accepts both second and millisecond epoch timestamps.
// If value > 1e10 (Nov 2286 in seconds), assume milliseconds.
function toCloudTimestamp(epoch: number): Date {
  return new Date(epoch > 1e10 ? epoch : epoch * 1000)
}

async function bulkInsertUnsynced(
  db: DrizzleClient,
  userId: string,
  characterId: string,
  items: unknown[],
  embed: (text: string) => Promise<number[]>,
): Promise<void> {
  const taskRows: {
    id: string;
    characterId: string;
    userId: string;
    title: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }[] = []
  const wikiEntryItems: UnsyncedWikiEntry[] = []
  const wikiRows: {
    id: string;
    entityId: string;
    userId: string;
    eventType: string;
    summary: string;
    createdAt: number;
  }[] = []

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
    } else if (item.type === 'wiki_entry') {
      if (typeof item.id !== 'string' || !item.id.trim()) continue
      if (typeof item.body !== 'string' || !item.body.trim()) continue
      wikiEntryItems.push(item)
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

  if (wikiEntryItems.length > 0) {
    const wikiEntryRows = await Promise.all(
      wikiEntryItems.map(async (item) => {
        let embedding: number[] | null = null
        try { embedding = await embed(item.body.trim()) } catch { /* log, insert with null */ }
        return {
          id: item.id.trim(), entityId: characterId, userId,
          title: (item.title ?? '').trim() || item.body.trim().slice(0, 64),
          body: item.body.trim(),
          tags: [],
          confidence: item.confidence === 'certain' ? 'certain' : 'inferred',
          sourceType: item.sourceType ?? 'agent_inferred',
          embedding,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt ?? item.createdAt,
        }
      }),
    )
    await db.insert(llmWikiEntries).values(wikiEntryRows).onConflictDoNothing()
  }

  if (wikiRows.length > 0) {
    await db.insert(llmWikiEvents).values(wikiRows).onConflictDoNothing()
  }
}

async function queryWikiContext(
  db: DrizzleClient,
  query: string,
  userId: string,
  characterId: string,
  embed: (text: string) => Promise<number[]>,
): Promise<string> {
  const normalizedQuery = query.trim().slice(0, 200)
  if (!normalizedQuery) return ''

  try {
    const vec = await embed(normalizedQuery)
    const rows = await db
      .select({ title: llmWikiEntries.title, body: llmWikiEntries.body })
      .from(llmWikiEntries)
      .where(and(
        eq(llmWikiEntries.entityId, characterId),
        eq(llmWikiEntries.userId, userId),
        isNull(llmWikiEntries.deletedAt),
      ))
      .orderBy(sql`${llmWikiEntries.embedding} <=> ${JSON.stringify(vec)}::vector`)
      .limit(5)
    return rows.map(r => `- ${r.title}: ${r.body}`).join('\n')
  } catch {
    // embedText failed — fall back to full-text search
    const rows = await db
      .select({ title: llmWikiEntries.title, body: llmWikiEntries.body })
      .from(llmWikiEntries)
      .where(and(
        eq(llmWikiEntries.entityId, characterId),
        eq(llmWikiEntries.userId, userId),
        isNull(llmWikiEntries.deletedAt),
        sql`to_tsvector('english', coalesce(${llmWikiEntries.title}, '') || ' ' || coalesce(${llmWikiEntries.body}, '')) @@ websearch_to_tsquery('english', ${normalizedQuery})`,
      ))
      .limit(5)
    return rows.map(r => `- ${r.title}: ${r.body}`).join('\n')
  }
}

function assembleSystemInstruction(
  character: { name: string; appearance: string | null; traits: string | null; emotions: string | null; context: string | null },
  wikiContext: string,
): string {
  return [
    `You are ${character.name}, a virtual friend.`,
    character.appearance && `Appearance: ${character.appearance}`,
    character.traits && `Traits: ${character.traits}`,
    character.emotions && `Emotions: ${character.emotions}`,
    character.context && `Context: ${character.context}`,
    `\nInstructions:\n- Stay in character as ${character.name} at all times\n- Never reveal you are an AI\n- Respond naturally and conversationally\n- Keep responses concise (1-3 sentences) unless depth is needed`,
    wikiContext && `\nKnown facts about the user:\n${wikiContext}`,
  ]
    .filter(Boolean)
    .join('\n')
}

// ── Real agent runner (production) ────────────────────────────────────────────

async function runAgentReal(params: RunAgentParams): Promise<{ reply: string; toolCalls: string[] }> {
  const { db, userId, characterId, systemInstruction, message, history, timezone, embed } = params
  const agent = buildAgent(db, userId, characterId, systemInstruction, timezone, embed)
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
      let result: { reply: string; toolCalls: string[] }
      try {
        result = await runAgentFn({ db, userId, characterId, systemInstruction, message, history, timezone, embed: embedText })
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

  return app
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
  const app = createApp({
    verifyToken: isMockAuth
      ? async (_token: string) => ({ uid: 'local_test_user_123' })
      : (token) => admin.auth().verifyIdToken(token).then((d) => ({ uid: d.uid })),
    db,
    runAgentFn: runAgentReal,
  })

  const port = process.env.PORT ?? '8080'
  app.listen(Number(port), '0.0.0.0', () => {
    console.log(`Cloud Agent listening on port ${port}`)
  })
}
