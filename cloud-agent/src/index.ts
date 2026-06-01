import express, { Request, Response, NextFunction } from 'express'
import admin from 'firebase-admin'
import { eq, and, ilike } from 'drizzle-orm'
import { InMemoryRunner, isFinalResponse } from '@google/adk'
import type { Content } from '@google/genai'
import { getDb } from './db/client.js'
import { buildAgent } from './agent.js'
import { characters, llmWikiEvents, tasks } from './db/schema.js'
import type { DrizzleClient } from './db/client.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RunAgentParams {
  db: DrizzleClient
  userId: string
  characterId: string
  systemInstruction: string
  message: string
  _history: Content[]
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
        status: item.status ?? 'open',
        createdAt: new Date(item.createdAt * 1000),
        updatedAt: new Date(),
      })
    } else if (item.type === 'wiki_event') {
      await db.insert(llmWikiEvents).values({
        id: item.id,
        entityId: characterId,
        userId,
        eventType: item.eventType ?? 'observation',
        summary: item.summary,
        createdAt: item.createdAt,
      })
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
  const { db, userId, characterId, systemInstruction, message } = params
  const agent = buildAgent(db, userId, characterId, systemInstruction)
  const runner = new InMemoryRunner({ agent, appName: 'clanker-cloud-agent' })

  const events = runner.runAsync({
    userId,
    sessionId: crypto.randomUUID(),
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
    const { message, characterId, unsyncedHistory = [] } = req.body as {
      message: string
      characterId: string
      unsyncedHistory?: unknown[]
    }
    const userId = req.uid!

    if (unsyncedHistory.length > 0) {
      await bulkInsertUnsynced(db, userId, characterId, unsyncedHistory)
    }

    const [character] = await db.select().from(characters).where(eq(characters.id, characterId))
    if (!character) { res.status(404).json({ error: 'Character not found' }); return }

    const wikiContext = await queryWikiContext(db, message, characterId)
    const systemInstruction = assembleSystemInstruction(character, wikiContext)

    const result = await runAgentFn({ db, userId, characterId, systemInstruction, message, _history: [] })
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
