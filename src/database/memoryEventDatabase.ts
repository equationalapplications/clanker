import { getDatabase } from '~/database/index'

interface LocalMemoryEvent {
  id: string
  event_type: string
  summary: string
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