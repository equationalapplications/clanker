import type { DrizzleClient } from '../db/client.js'
import { llmWikiEvents, llmWikiEntries, tasks } from '../db/schema.js'

type UnsyncedTask = { type: 'task'; id: string; title: string; status: string; createdAt: number }
type UnsyncedWikiEntry = { type: 'wiki_entry'; id: string; title: string; body: string; confidence?: string; sourceType?: string; createdAt: number; updatedAt: number }
type UnsyncedWikiEvent = { type: 'wiki_event'; id: string; eventType: string; summary: string; createdAt: number }
type UnsyncedItem = UnsyncedTask | UnsyncedWikiEntry | UnsyncedWikiEvent

function toCloudStatus(status: string): string {
  const normalized = status === 'pending' ? 'open' : (status || 'open')
  return ['open', 'done', 'abandoned'].includes(normalized) ? normalized : 'open'
}

function toCloudTimestamp(epoch: number): Date {
  return new Date(epoch > 1e10 ? epoch : epoch * 1000)
}

export async function bulkInsertUnsynced(
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
      if (typeof item.createdAt !== 'number' || typeof item.updatedAt !== 'number') continue
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
        try { embedding = await embed(item.body.trim()) } catch { /* insert with null */ }
        return {
          id: item.id.trim(), entityId: characterId, userId,
          title: (item.title ?? '').trim() || item.body.trim().slice(0, 64),
          body: item.body.trim(),
          tags: [],
          confidence: item.confidence === 'certain' ? 'certain' : 'inferred',
          sourceType: item.sourceType ?? 'agent_inferred',
          embedding,
          createdAt: toCloudTimestamp(item.createdAt).getTime(),
          updatedAt: toCloudTimestamp(item.updatedAt).getTime(),
        }
      }),
    )
    await db.insert(llmWikiEntries).values(wikiEntryRows).onConflictDoNothing()
  }

  if (wikiRows.length > 0) {
    await db.insert(llmWikiEvents).values(wikiRows).onConflictDoNothing()
  }
}
