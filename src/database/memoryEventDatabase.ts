import { getDatabase } from '~/database/index'

interface LocalMemoryEvent {
  id: string
  character_id: string
  user_id: string
  event_type: string
  summary: string
  related_entry_id: string | null
  related_task_id: string | null
  source_ref: string | null
  created_at: number
  synced_to_cloud: number
  cloud_id: string | null
}

export interface MemoryEventUpsertInput {
  id: string
  characterId: string
  userId: string
  eventType: 'observation' | 'decision' | 'action' | 'outcome'
  summary: string
  relatedEntryId?: string | null
  relatedTaskId?: string | null
  sourceRef?: string | null
  createdAt?: number
  syncedToCloud?: number
  cloudId?: string | null
}

export interface MemoryEventView {
  id: string
  eventType: string
  summary: string
}

export async function getRecentEvents(
  characterId: string,
  limit: number,
): Promise<MemoryEventView[]> {
  const db = await getDatabase()
  const rows = await db.getAllAsync<LocalMemoryEvent>(
    `SELECT id, event_type, summary
     FROM memory_events
     WHERE character_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [characterId, limit],
  )

  return rows.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    summary: row.summary,
  }))
}

export async function appendMemoryEvents(events: MemoryEventUpsertInput[]): Promise<void> {
  if (events.length === 0) {
    return
  }

  const db = await getDatabase()

  await db.withTransactionAsync(async () => {
    for (const event of events) {
      await db.runAsync(
        `INSERT INTO memory_events (
          id,
          character_id,
          user_id,
          event_type,
          summary,
          related_entry_id,
          related_task_id,
          source_ref,
          created_at,
          synced_to_cloud,
          cloud_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          event_type = excluded.event_type,
          summary = excluded.summary,
          related_entry_id = excluded.related_entry_id,
          related_task_id = excluded.related_task_id,
          source_ref = excluded.source_ref,
          synced_to_cloud = excluded.synced_to_cloud,
          cloud_id = excluded.cloud_id`,
        [
          event.id,
          event.characterId,
          event.userId,
          event.eventType,
          event.summary.trim(),
          event.relatedEntryId ?? null,
          event.relatedTaskId ?? null,
          event.sourceRef ?? null,
          event.createdAt ?? Date.now(),
          event.syncedToCloud ?? 0,
          event.cloudId ?? null,
        ],
      )
    }
  })
}