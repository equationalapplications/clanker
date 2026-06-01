import express, { Request, Response, NextFunction } from 'express'
import admin from 'firebase-admin'
import { eq, and, ilike } from 'drizzle-orm'
import { InMemoryRunner, isFinalResponse, createEvent, createEventActions } from '@google/adk'
import type { Content } from '@google/genai'
import { getDb } from './db/client.js'
import { buildAgent } from './agent.js'
import { users, characters, llmWikiEvents, tasks } from './db/schema.js'
import type { DrizzleClient } from './db/client.js'

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
  for (const raw of items) {
    const item = raw as UnsyncedItem
    if (item.type === 'task') {
      await db.insert(tasks).values({
        id: item.id,
        characterId,
        userId,
        title: item.title,
        status: toCloudStatus(item.status),
        createdAt: toCloudTimestamp(item.createdAt),
        updatedAt: new Date(),
      }).onConflictDoNothing()
    } else if (item.type === 'wiki_event') {
      const allowedEvents = ['observation', 'decision', 'action', 'outcome'] as const
      type AllowedEvent = (typeof allowedEvents)[number]
      const eventType = allowedEvents.includes(item.eventType as AllowedEvent)
        ? item.eventType
        : 'observation'
      await db.insert(llmWikiEvents).values({
        id: item.id,
        entityId: characterId,
        userId,
        eventType,
        summary: item.summary,
        createdAt: toCloudTimestamp(item.createdAt).getTime(),
      }).onConflictDoNothing()
    }
  }
}

async function queryWikiContext(db: DrizzleClient, query: string, characterId: string): Promise<string> {
  const rows = await db
    .select({ summary: llmWikiEvents.summary })
    .from(llmWikiEvents)
    .where(and(eq(llmWikiEvents.entityId, characterId), ilike(llmWikiEvents.summary, `%${query}%`)))
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
  return { reply, toolCalls }
}

// ── App factory ───────────────────────────────────────────────────────────────

export function createApp(options: AppOptions) {
  const { verifyToken, db, runAgentFn } = options
  const app = express()
  app.use(express.json())

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' })
  })

  const requireAuth = async (
    req: Request & { uid?: string },
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const token = req.headers.authorization?.split('Bearer ')[1]
    if (!token) { res.status(401).json({ error: 'Unauthorized' }); return }
    try {
      const decoded = await verifyToken(token)
      req.uid = decoded.uid
      next()
    } catch {
      res.status(401).json({ error: 'Unauthorized' })
    }
  }

  app.post('/agent/run', requireAuth, async (req: Request & { uid?: string }, res: Response): Promise<void> => {
    const { message, characterId, unsyncedHistory = [], history = [] } = req.body as {
      message: string
      characterId: string
      unsyncedHistory?: unknown[]
      history?: Content[]
    }
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
      } catch {
        // Swallow sync errors so the agent can still respond (matches Firebase generateReply behavior)
      }
    }

    const wikiContext = await queryWikiContext(db, message, characterId)
    const systemInstruction = assembleSystemInstruction(character, wikiContext)

    const result = await runAgentFn({ db, userId, characterId, systemInstruction, message, history })
    res.json(result)
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
  app.listen(Number(port), () => {
    console.log(`Cloud Agent listening on port ${port}`)
  })
}
