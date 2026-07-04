import type { MemoryDump, WikiMemory } from '@equationalapplications/expo-llm-wiki'

function utcDayKey(createdAt: number): string {
  return new Date(createdAt).toISOString().slice(0, 10)
}

function eventDedupeKey(event: { event_type: string; summary: string; created_at: number }): string {
  const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|')
  return `${escape(event.event_type)}|${escape(event.summary)}|${utcDayKey(event.created_at)}`
}

export async function dedupeEventsAgainstExisting(
  wiki: WikiMemory,
  entityId: string,
  dump: MemoryDump,
): Promise<MemoryDump> {
  const entity = dump.entities[entityId]
  if (!entity || entity.events.length === 0) return dump

  const existingDump = await wiki.exportDump([entityId])
  const existingEvents = existingDump.entities[entityId]?.events ?? []
  const existingKeys = new Set(existingEvents.map(eventDedupeKey))

  const dedupedEvents = entity.events.filter((event) => !existingKeys.has(eventDedupeKey(event)))

  return {
    ...dump,
    entities: {
      ...dump.entities,
      [entityId]: {
        ...entity,
        events: dedupedEvents,
      },
    },
  }
}
